#!/usr/bin/env bash
# =============================================================================
# End-to-end test of the single-branch DAILY CYCLE on a LOCAL COPY of a backup.
# Never touches Railway: it starts a throw-away MySQL on this machine, restores
# the backup into it, runs the app locally against it, drives the real API,
# then deletes everything.
#
#   admission -> group -> instructor -> add students (auto invoices) ->
#   attendance (security + auto start date + 50% warning) -> payments
#   (installments, over-payment, concurrency, warning cleared) -> advance
#   cycle (guards, carry-over) -> waiting list -> last month -> result ->
#   certificate
#
# Usage (Git Bash, from the repo root):
#   bash scripts/e2e/daily-cycle.sh "D:/TechNovaBackups/<backup>.sql.gz" [D:/mysql]
# Exit code 0 = all steps passed.
# =============================================================================
set -u
BACKUP="${1:?path to a .sql.gz backup}"
MYSQL_DIR="${2:-D:/mysql}"
DB_PORT=3499
APP_PORT=5099
DATA_DIR="D:/tn-e2e-data"
URL="mysql://root@127.0.0.1:${DB_PORT}/e2e"
B="http://localhost:${APP_PORT}"
JAR="$(mktemp)"
SECRET="e2e-local-only-$(date +%s)-secret-value"
PASS=0; FAIL=0
M() { "$MYSQL_DIR/bin/mysql.exe" --no-defaults -h 127.0.0.1 -P $DB_PORT -u root --default-character-set=utf8mb4 -B -N e2e -e "$1" | tr -d '\r'; }
ok()   { PASS=$((PASS+1)); echo "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }
jq_() { python -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }
api() { if [ -n "${3:-}" ]; then curl -s -b "$JAR" -X "$1" -H 'Content-Type: application/json' -d "$3" "$B$2"; else curl -s -b "$JAR" -X "$1" "$B$2"; fi; }

cleanup() {
  # E2E_KEEP=1: leave the local test DB + app running to look at the screens; stop them by hand afterwards.
  if [ "${E2E_KEEP:-}" = 1 ]; then echo "kept running: $B (DB port $DB_PORT)"; return; fi
  [ -n "${APP_PID:-}" ] && taskkill //PID "$APP_PID" //T //F >/dev/null 2>&1
  powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $APP_PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
  "$MYSQL_DIR/bin/mysqladmin.exe" --no-defaults -h 127.0.0.1 -P $DB_PORT -u root shutdown >/dev/null 2>&1
  sleep 3; cp -f /d/tn-e2e-app.log /d/tn-e2e-app-last.log 2>/dev/null; rm -rf "$DATA_DIR" "$JAR" /d/tn-e2e-restore.sql /d/tn-e2e-app.log /d/tn-e2e-p*.txt
}
trap cleanup EXIT

echo "== setup: local MySQL + restore + schema + app"
rm -rf "$DATA_DIR"
"$MYSQL_DIR/bin/mysqld.exe" --no-defaults --initialize-insecure --basedir="$MYSQL_DIR" --datadir="$DATA_DIR" --lower-case-table-names=2 >/dev/null 2>&1
("$MYSQL_DIR/bin/mysqld.exe" --no-defaults --basedir="$MYSQL_DIR" --datadir="$DATA_DIR" --port=$DB_PORT --bind-address=127.0.0.1 --mysqlx=OFF --lower-case-table-names=2 --max-allowed-packet=256M >/dev/null 2>&1 &)
for i in $(seq 1 40); do "$MYSQL_DIR/bin/mysqladmin.exe" --no-defaults -h 127.0.0.1 -P $DB_PORT -u root ping >/dev/null 2>&1 && break; sleep 1; done
"$MYSQL_DIR/bin/mysql.exe" --no-defaults -h 127.0.0.1 -P $DB_PORT -u root -e "CREATE DATABASE e2e CHARACTER SET utf8mb4"
gzip -dc "$BACKUP" > /d/tn-e2e-restore.sql && "$MYSQL_DIR/bin/mysql.exe" --no-defaults -h 127.0.0.1 -P $DB_PORT -u root --default-character-set=utf8mb4 e2e -e "source D:/tn-e2e-restore.sql"
DATABASE_URL="$URL" npx prisma db push --skip-generate --accept-data-loss >/tmp/tn-e2e-push.log 2>&1 || { echo "schema push failed"; cat /tmp/tn-e2e-push.log; exit 1; }
cat > scripts/e2e/.tmp-sa.ts <<'EOF'
import { prisma } from '../../lib/prisma'
import { hash } from '@node-rs/argon2'
async function main() {
  const u = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
  await prisma.user.update({ where: { id: u!.id }, data: { passwordHash: await hash('E2eAdmin123'), mustChangePassword: false } })
  console.log(u!.email); await prisma.$disconnect()
}
main()
EOF
SA_EMAIL=$(DATABASE_URL="$URL" npx tsx scripts/e2e/.tmp-sa.ts); rm -f scripts/e2e/.tmp-sa.ts
# E2E_PROD=1: build once and run `next start` (steadier and lighter than the dev server, which can run out of memory
# compiling routes on demand on a busy machine). Default: `next dev`.
if [ "${E2E_PROD:-}" = 1 ]; then
  echo "building the app (E2E_PROD=1)…"
  npx next build > /d/tn-e2e-build.log 2>&1 || { echo "build failed"; tail -20 /d/tn-e2e-build.log; exit 1; }
  DATABASE_URL="$URL" AUTH_SECRET="$SECRET" NEXTAUTH_SECRET="$SECRET" NEXTAUTH_URL="$B" AUTH_TRUST_HOST=true PAYMOB_HMAC_SECRET="e2e-paymob-hmac" CRON_SECRET="e2e-cron" npx next start -p $APP_PORT > /d/tn-e2e-app.log 2>&1 &
else
DATABASE_URL="$URL" AUTH_SECRET="$SECRET" NEXTAUTH_SECRET="$SECRET" NEXTAUTH_URL="$B" PAYMOB_HMAC_SECRET="e2e-paymob-hmac" CRON_SECRET="e2e-cron" NODE_OPTIONS="--max-old-space-size=6144" npx next dev -p $APP_PORT > /d/tn-e2e-app.log 2>&1 &
fi
APP_PID=$!
for i in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/auth/csrf)" = "200" ] && break; sleep 3; done
tok=$(curl -s -c "$JAR" -b "$JAR" $B/api/auth/csrf | jq_ "d['csrfToken']")
curl -s -o /dev/null -c "$JAR" -b "$JAR" -X POST $B/api/auth/callback/credentials --data-urlencode "csrfToken=$tok" --data-urlencode "email=$SA_EMAIL" --data-urlencode "password=E2eAdmin123" --data-urlencode "callbackUrl=$B/dashboard"
check "super admin logged in" "$(api GET /api/auth/session | jq_ "d['user']['role']")" "SUPER_ADMIN"

CAMPUS=$(M "SELECT id FROM Campus WHERE isActive=1 ORDER BY createdAt LIMIT 1")
BATCH=$(M "SELECT id FROM Batch WHERE campusId='$CAMPUS' LIMIT 1")
SHIFT=$(M "SELECT id FROM Shift LIMIT 1")
LEVEL=$(M "SELECT id FROM Level WHERE pricingType='MONTHLY' AND numberOfMonths>=2 AND IFNULL(monthlyPrice,0)>0 ORDER BY \`order\` LIMIT 1")
SUBJECT=$(M "SELECT subjectId FROM Level WHERE id='$LEVEL'")
TEACHER=$(M "SELECT id FROM Teacher LIMIT 1")
[ -n "$LEVEL" ] || { echo "backup has no MONTHLY level with >=2 months and a price"; exit 1; }

echo "== 1. admission"
stu() { echo "{\"firstName\":\"$1\",\"lastName\":\"E2e\",\"fullNameAr\":\"طالب اختبار $1\",\"fatherName\":\"Father $1\",\"fatherPhoneNumber\":\"\",\"motherName\":\"\",\"parentStatus\":\"BOTH_ALIVE\",\"dateOfBirth\":\"2016-05-10T00:00:00.000Z\",\"gender\":\"MALE\",\"nationality\":\"Egyptian\",\"address\":\"12 Nasr St Hurghada\",\"city\":\"Hurghada\",\"phoneNumber\":\"$2\",\"emergencyContact\":\"$2\",\"email\":\"\",\"hasSiblingAtAcademy\":false,\"campusId\":\"$CAMPUS\",\"batchId\":\"$BATCH\",\"rollNumber\":\"\",\"academicYear\":\"2025-2026\",\"totalFeeAmount\":0,\"guardianFirstName\":\"$3\",\"guardianLastName\":\"\",\"guardianPhone\":\"$4\",\"guardianEmail\":\"\",\"guardianRelationship\":\"\"}"; }
R1=$(api POST /api/students "$(stu Alpha 01099990001 '' '')"); R2=$(api POST /api/students "$(stu Beta 01099990002 '' '')")
R3=$(api POST /api/students "$(stu Gamma 01099990003 Hany 01088880001)"); R4=$(api POST /api/students "$(stu Delta 01099990004 Hany 01088880001)")
for r in "$R1" "$R2" "$R3" "$R4"; do check "student created without email / optional fields" "$(echo "$r" | jq_ "d['success']")" "True"; done
check "sibling linked to the same parent" "$(M "SELECT COUNT(*) FROM _GuardianToStudent gs JOIN Guardian g ON g.id=gs.A WHERE g.phoneNumber='01088880001'")" "2"
check "no empty login emails" "$(M "SELECT COUNT(*) FROM User WHERE email=''")" "0"
REGS=$(M "SELECT COUNT(DISTINCT registrationNumber) FROM Student WHERE lastName='E2e' AND registrationNumber REGEXP '^TN/[0-9]{4}/[0-9]{4}$'")
check "registration numbers unique and TN/YYYY/NNNN" "$REGS" "4"

echo "== 2. group + instructor + students"
G='{"campusId":"'$CAMPUS'","batchId":"'$BATCH'","shiftId":"'$SHIFT'","className":"E2E Cycle","sectionName":"Z","levelId":"'$LEVEL'"}'
check "group created" "$(api POST /api/groups "$G" | jq_ "d['success']")" "True"
check "duplicate group name -> clear 409" "$(api POST /api/groups "$G" | jq_ "d['error']['code']")" "CONFLICT"
GID=$(M "SELECT id FROM ClassSection WHERE className='E2E Cycle'")
check "instructor assigned" "$(api POST /api/groups/$GID/instructor "{\"teacherId\":\"$TEACHER\"}" | jq_ "d['success']")" "True"
check "instructor shown in group details" "$(api GET /api/groups/$GID | jq_ "bool(d['data']['teacher'])")" "True"
for sid in $(M "SELECT id FROM Student WHERE lastName='E2e' ORDER BY registrationNumber"); do api POST /api/groups/$GID/students "{\"studentId\":\"$sid\"}" >/dev/null; done
check "4 students in group" "$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE classSectionId='$GID' AND status='ACTIVE'")" "4"
check "each added student got an invoice" "$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$GID'")" "4"

echo "== 3. attendance"
E=($(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$GID' ORDER BY rollNumber"))
OTHER=$(M "SELECT id FROM StudentEnrollment WHERE classSectionId<>'$GID' LIMIT 1")
rec() { echo "{\"studentEnrollmentId\":\"$1\",\"status\":\"$2\"}"; }
sess() { api POST /api/enrollment-attendance "{\"classSectionId\":\"$1\",\"attendanceDate\":\"$2\",\"records\":[$3]}"; }
ALL() { echo "$(rec ${E[0]} PRESENT),$(rec ${E[1]} ABSENT),$(rec ${E[2]} PRESENT),$(rec ${E[3]} LATE)"; }
check "invalid status rejected" "$(sess $GID 2026-01-04 "$(rec ${E[0]} HERE)" | jq_ "d['success']")" "False"
[ -n "$OTHER" ] && check "student from another group rejected" "$(sess $GID 2026-01-04 "$(rec $OTHER ABSENT)" | jq_ "d['success']")" "False"
PER=$(M "SELECT GREATEST(1, ROUND(numberOfSessions/numberOfMonths)) FROM Level WHERE id='$LEVEL'")
HALF=$(( (PER + 1) / 2 ))
for i in $(seq 1 $HALF); do sess $GID "2026-01-0$((i+3))" "$(ALL)" >/dev/null; done
check "group became ACTIVE after first attendance (no one opened it)" "$(api GET /api/groups | jq_ "[g['displayStatus'] for g in d['data'] if g['id']=='$GID'][0]")" "ACTIVE"
check "group shows cycle-end and level-end estimates" "$(api GET /api/groups/$GID | jq_ "bool(d['data']['ends']['cycleEnd']) and bool(d['data']['ends']['levelEnd'])")" "True"
check "unpaid students flagged at 50%" "$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE classSectionId='$GID' AND withdrawalReason='PAYMENT_OVERDUE_WARNING'")" "4"

echo "== 4. payments"
INV=($(M "SELECT i.id FROM FeeInvoice i JOIN StudentEnrollment e ON e.studentId=i.studentId AND e.classSectionId=i.classSectionId WHERE i.classSectionId='$GID' ORDER BY e.rollNumber"))
AMT=$(M "SELECT CAST(totalAmount AS UNSIGNED) FROM FeeInvoice WHERE id='${INV[0]}'")
pay() { api POST /api/fees/$1/payments "{\"amount\":$2,\"paymentMethod\":\"Cash\"}"; }
check "partial payment refused (installments off)" "$(pay ${INV[0]} 1 | jq_ "d['success']")" "False"
check "over-payment refused" "$(pay ${INV[0]} $((AMT+100)) | jq_ "d['success']")" "False"
check "full payment accepted" "$(pay ${INV[0]} $AMT | jq_ "d['success']")" "True"
(pay ${INV[1]} $AMT > /d/tn-e2e-p1.txt &); (pay ${INV[1]} $AMT > /d/tn-e2e-p2.txt &); sleep 10
check "two payments at the same moment -> recorded once" "$(M "SELECT COUNT(*) FROM FeePayment WHERE invoiceId='${INV[1]}'")" "1"
check "invoice not over-paid" "$(M "SELECT paidAmount<=totalAmount FROM FeeInvoice WHERE id='${INV[1]}'")" "1"
check "warning cleared right after payment" "$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE classSectionId='$GID' AND withdrawalReason='PAYMENT_OVERDUE_WARNING'")" "2"

echo "== 5. advance cycle"
check "closing before the cycle ends is refused" "$(api POST /api/groups/$GID/advance-cycle '{"continuingStudentIds":[]}' | jq_ "d['success']")" "False"
for i in $(seq $((HALF+1)) $PER); do sess $GID "2026-01-$((i+10))" "$(ALL)" >/dev/null; done
PAID=$(M "SELECT CONCAT('\"',e.studentId,'\"') FROM StudentEnrollment e WHERE e.classSectionId='$GID' AND e.withdrawalReason IS NULL" | paste -sd,)
FOREIGN=$(M "SELECT id FROM Student WHERE lastName<>'E2e' LIMIT 1")
check "outsider in continuing list refused" "$(api POST /api/groups/$GID/advance-cycle "{\"continuingStudentIds\":[$PAID,\"$FOREIGN\"]}" | jq_ "d['success']")" "False"
check "cycle advanced with the 2 who paid" "$(api POST /api/groups/$GID/advance-cycle "{\"continuingStudentIds\":[$PAID]}" | jq_ "d['success']")" "True"
G2=$(M "SELECT newClassSectionId FROM GroupCycleLog WHERE classSectionId='$GID'")
check "old group COMPLETED" "$(M "SELECT status FROM ClassSection WHERE id='$GID'")" "COMPLETED"
check "new group has the 2 continuing students" "$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE classSectionId='$G2'")" "2"
check "continuing students invoiced for next month" "$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$G2'")" "2"
check "instructor carried over" "$(api GET /api/groups/$G2 | jq_ "bool(d['data']['teacher'])")" "True"
check "no new sessions on the closed group" "$(sess $GID 2027-01-01 "$(rec ${E[0]} PRESENT)" | jq_ "d['success']")" "False"
check "the 2 who stopped appear in 'finished, didn't continue'" "$(api GET /api/waiting-list | jq_ "len([f for f in d['data']['finished'] if f['finishedGroup']['id']=='$GID'])")" "2"

echo "== 6. last month -> result -> certificate"
E2=($(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$G2' ORDER BY rollNumber"))
for i in $(seq 1 $PER); do api POST /api/enrollment-attendance "{\"classSectionId\":\"$G2\",\"attendanceDate\":\"2026-02-$((i+10))\",\"records\":[$(rec ${E2[0]} PRESENT),$(rec ${E2[1]} PRESENT)]}" >/dev/null; done
LAST=$(M "SELECT currentCycleNumber >= (SELECT numberOfMonths FROM Level WHERE id=cs.levelId) FROM ClassSection cs WHERE id='$G2'")
RES=$(api POST /api/level-results "{\"studentEnrollmentId\":\"${E2[0]}\",\"subjectId\":\"$SUBJECT\",\"homeworkScore\":95,\"taskScore\":95,\"instructorScore\":95,\"projectScore\":95,\"mcqScore\":95,\"instructorFeedback\":\"Excellent work\"}")
check "result saved" "$(echo "$RES" | jq_ "d['success']")" "True"
if [ "$LAST" = "1" ]; then
  check "certificate issued at the end of the level" "$(echo "$RES" | jq_ "d['data']['certificateIssued']")" "True"
  check "certificate number format TN-CERT-YYYY-NNNNN" "$(M "SELECT COUNT(*) FROM Certificate WHERE certificateNumber REGEXP '^TN-CERT-[0-9]{4}-[0-9]{5}$' AND levelResultId IN (SELECT id FROM StudentLevelResult WHERE studentEnrollmentId='${E2[0]}')")" "1"
fi

echo "== 7. FULL_LEVEL: one cycle = the whole level"
MAXORD=$(M "SELECT MAX(\`order\`) FROM Level WHERE subjectId='$SUBJECT'")
LF='{"subjectId":"'$SUBJECT'","name":"E2E Full","order":'$((MAXORD+1))',"numberOfMonths":2,"numberOfSessions":6,"pricingType":"FULL_LEVEL","fullLevelPrice":1500}'
LA='{"subjectId":"'$SUBJECT'","name":"E2E After","order":'$((MAXORD+2))',"numberOfMonths":1,"numberOfSessions":4,"pricingType":"MONTHLY","monthlyPrice":500}'
check "full-level level created" "$(api POST /api/levels "$LF" | jq_ "d['success']")" "True"
api POST /api/levels "$LA" >/dev/null
LFID=$(M "SELECT id FROM Level WHERE name='E2E Full'"); LAID=$(M "SELECT id FROM Level WHERE name='E2E After'")
api POST /api/groups '{"campusId":"'$CAMPUS'","batchId":"'$BATCH'","shiftId":"'$SHIFT'","className":"E2E Full Group","sectionName":"F","levelId":"'$LFID'"}' >/dev/null
GF=$(M "SELECT id FROM ClassSection WHERE className='E2E Full Group'")
SF=$(M "SELECT id FROM Student WHERE lastName='E2e' ORDER BY registrationNumber LIMIT 1")
api POST /api/groups/$GF/students "{\"studentId\":\"$SF\"}" >/dev/null
check "one invoice for the whole level (1500, no month)" "$(M "SELECT CONCAT(CAST(totalAmount AS UNSIGNED),'/',IFNULL(cycleNumber,'none')) FROM FeeInvoice WHERE classSectionId='$GF'")" "1500/none"
EF=$(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$GF'")
for i in 1 2 3; do sess $GF "2026-03-0$i" "$(rec $EF PRESENT)" >/dev/null; done
check "cycle counts ALL the level's sessions (x/6, cycle 1/1)" "$(api GET /api/groups/$GF | jq_ "str(d['data']['ends']['sessionsPerCycle'])+'/'+str(d['data']['ends']['cyclesInLevel'])")" "6/1"
check "cannot close after 3 of 6 sessions" "$(api POST /api/groups/$GF/advance-cycle "{\"continuingStudentIds\":[\"$SF\"]}" | jq_ "d['success']")" "False"
for i in 4 5 6; do sess $GF "2026-03-0$i" "$(rec $EF PRESENT)" >/dev/null; done
check "after 6 of 6 -> moves to the NEXT level" "$(api POST /api/groups/$GF/advance-cycle "{\"continuingStudentIds\":[\"$SF\"]}" | jq_ "d['data']['action']")" "LEVEL_COMPLETED"
GF2=$(M "SELECT newClassSectionId FROM GroupCycleLog WHERE classSectionId='$GF'")
check "new group is on the next level" "$(M "SELECT levelId FROM ClassSection WHERE id='$GF2'")" "$LAID"

echo "== 8. parent portal"
GJAR="$(mktemp)"
login_as() { # id pw jar -> prints redirect Location
  local t; t=$(curl -s -c "$3" -b "$3" $B/api/auth/csrf | jq_ "d['csrfToken']")
  curl -s -o /dev/null -D - -c "$3" -b "$3" -X POST $B/api/auth/callback/credentials --data-urlencode "csrfToken=$t" --data-urlencode "email=$1" --data-urlencode "password=$2" --data-urlencode "callbackUrl=$B/dashboard" | grep -i '^location' | tr -d '\r'
}
PHONE=01088880001
GUSER=$(M "SELECT userId FROM Guardian WHERE phoneNumber='$PHONE'")
GUARD=$(M "SELECT id FROM Guardian WHERE phoneNumber='$PHONE'")
case "$(login_as $PHONE $PHONE "$GJAR")" in *default_password*) ok "phone number as password is refused";; *) bad "phone number as password is refused";; esac
check "staff issues a temporary password" "$(api POST /api/users/reset-credentials "{\"userId\":\"$GUSER\",\"newPassword\":\"TempPass123\"}" | jq_ "d['success']")" "True"
rm -f "$GJAR"; login_as $PHONE TempPass123 "$GJAR" >/dev/null
check "parent signs in with the phone number" "$(curl -s -b "$GJAR" $B/api/auth/session | jq_ "d['user']['role']")" "GUARDIAN"
case "$(curl -s -o /dev/null -D - -b "$GJAR" $B/dashboard/my-children | grep -i '^location')" in *change-password*) ok "forced to change the temporary password";; *) bad "forced to change the temporary password";; esac
check "password changed" "$(curl -s -b "$GJAR" -X POST -H 'Content-Type: application/json' -d '{"currentPassword":"TempPass123","newPassword":"Parent2026A","confirmPassword":"Parent2026A"}' $B/api/users/change-password | jq_ "d['success']")" "True"
rm -f "$GJAR"; login_as $PHONE Parent2026A "$GJAR" >/dev/null
check "parent sees exactly their 2 children" "$(curl -s -b "$GJAR" $B/api/guardian-portal/children | jq_ "len(d['data'] if isinstance(d['data'],list) else d['data'].get('children',[]))")" "2"
for u in /api/exports/students /api/groups /api/students /api/teachers "/api/groups/$GID"; do check "parent blocked from $u" "$(curl -s -o /dev/null -w '%{http_code}' -b "$GJAR" $B$u)" "403"; done
NOTMINE=$(M "SELECT id FROM Student WHERE id NOT IN (SELECT B FROM _GuardianToStudent WHERE A='$GUARD') LIMIT 1")
check "parent gets no fees of another child" "$(curl -s -b "$GJAR" "$B/api/fees?studentId=$NOTMINE" | jq_ "len(d['data'])")" "0"

echo "== 9. parent phone changes -> login follows"
OTHERPHONE=$(M "SELECT phoneNumber FROM Guardian WHERE phoneNumber<>'$PHONE' LIMIT 1")
[ -n "$OTHERPHONE" ] && check "number of another parent is refused" "$(api PATCH /api/guardians/$GUARD/phone "{\"phoneNumber\":\"$OTHERPHONE\"}" | jq_ "d['success']")" "False"
check "phone changed" "$(api PATCH /api/guardians/$GUARD/phone '{"phoneNumber":"01088880009"}' | jq_ "d['success']")" "True"
rm -f "$GJAR"; login_as 01088880009 Parent2026A "$GJAR" >/dev/null
check "parent signs in with the NEW number" "$(curl -s -b "$GJAR" $B/api/auth/session | jq_ "d['user']['role']")" "GUARDIAN"
rm -f "$GJAR"
case "$(login_as $PHONE Parent2026A "$GJAR")" in *error=*) ok "old number no longer signs in";; *) bad "old number no longer signs in";; esac
rm -f "$GJAR"

echo "== 10. waiting list wish -> placed"
SW=$(M "SELECT e.studentId FROM StudentEnrollment e WHERE e.classSectionId='$GID' AND e.studentId NOT IN (SELECT studentId FROM StudentEnrollment WHERE classSectionId='$G2') LIMIT 1")
check "wish recorded" "$(api POST /api/waiting-list/entries "{\"studentId\":\"$SW\",\"subjectId\":\"$SUBJECT\",\"levelId\":\"$LEVEL\"}" | jq_ "d['success']")" "True"
check "wish listed" "$(api GET /api/waiting-list | jq_ "len([w for w in d['data']['wishes'] if w['student']['id']=='$SW'])")" "1"
api POST /api/groups/$G2/students "{\"studentId\":\"$SW\"}" >/dev/null
check "wish marked PLACED when added to a matching group" "$(M "SELECT status FROM WaitingListEntry WHERE studentId='$SW'")" "PLACED"
check "student added from the waiting list is invoiced" "$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$G2' AND studentId='$SW'")" "1"

echo "== 11. initial setup (base data)"
TODO=$(api GET /api/admin/setup | jq_ "len([s for s in d['data']['steps'] if s['status']=='TODO'])")
[ "$TODO" -gt 0 ] && ok "preview lists $TODO step(s) to do" || bad "preview lists steps to do"
check "setup applied" "$(api POST /api/admin/setup | jq_ "d['success']")" "True"
check "everything DONE after applying" "$(api GET /api/admin/setup | jq_ "len([s for s in d['data']['steps'] if s['status']=='TODO'])")" "0"
check "applying again changes nothing" "$(api POST /api/admin/setup | jq_ "d['success']")" "True"
check "main branch renamed" "$(M "SELECT CONCAT(name,'/',code) FROM Campus WHERE isActive=1")" "TechNova Company/TN"
check "only one active branch" "$(M "SELECT COUNT(*) FROM Campus WHERE isActive=1")" "1"
check "5 tracks" "$(M "SELECT COUNT(*) FROM Track WHERE name LIKE 'Nova%'")" "5"
check "30 levels (5 x 6), 2 months, 8 sessions, 850 monthly" "$(M "SELECT COUNT(*) FROM Level l JOIN AcademicSubject s ON s.id=l.subjectId WHERE s.code LIKE 'NOVA-%' AND l.numberOfMonths=2 AND l.numberOfSessions=8 AND l.pricingType='MONTHLY' AND l.monthlyPrice=850")" "30"
check "no duplicates after 2 runs" "$(M "SELECT COUNT(*) FROM AcademicSubject WHERE code LIKE 'NOVA-%'")" "5"
check "batch General exists" "$(M "SELECT COUNT(*) FROM Batch b JOIN Campus c ON c.id=b.campusId WHERE b.name='General' AND c.code='TN'")" "1"
check "internal year active, unlocked, never expires" "$(M "SELECT COUNT(*) FROM AcademicYear WHERE isActive=1 AND isLocked=0 AND endDate>='2099-01-01'")" "1"
check "public form now shows only the main branch" "$(curl -s $B/api/admissions/public-options | jq_ "','.join(c['name'] for c in d['data']['campuses'])")" "TechNova Company"

echo "== 12. delete test data (safety + result)"
PREV=$(api GET /api/admin/wipe-test-data)
check "preview ready" "$(echo "$PREV" | jq_ "d['data']['ready']")" "True"
STUDENTS_BEFORE=$(M "SELECT COUNT(*) FROM Student")
check "wrong confirmation refused" "$(api POST /api/admin/wipe-test-data '{"confirm":"yes"}' | jq_ "d['success']")" "False"
if [ -z "${CLOUDINARY_API_KEY:-}" ]; then
  # Locally there is no Cloudinary, so the automatic backup fails -> must delete NOTHING.
  python -c "import json;json.dump({'confirm':'  امسح  كل بيانات التجربة '},open('D:/tn-e2e-confirm.json','w',encoding='utf-8'),ensure_ascii=False)"
  check "backup fails -> nothing deleted (refused)" "$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json; charset=utf-8' --data-binary @/d/tn-e2e-confirm.json $B/api/admin/wipe-test-data | jq_ "d['error']['code']")" "BACKUP_FAILED"
  rm -f /d/tn-e2e-confirm.json
  check "students still there after refused wipe" "$(M "SELECT COUNT(*) FROM Student")" "$STUDENTS_BEFORE"
fi
# Run the wipe itself directly (the backup step is covered above).
SA_ID=$(M "SELECT id FROM User WHERE role='SUPER_ADMIN' ORDER BY createdAt LIMIT 1")
cat > scripts/e2e/.tmp-wipe.ts <<EOF
import { wipeTestData } from '../../lib/setup/wipe-test-data'
import { prisma } from '../../lib/prisma'
wipeTestData('$SA_ID').then((r) => { console.log(Object.keys(r.deleted).length); return prisma.\$disconnect() }).catch((e) => { console.log('ERR', e.message); process.exit(1) })
EOF
WIPED=$(DATABASE_URL="$URL" npx tsx scripts/e2e/.tmp-wipe.ts 2>&1 | tail -1); rm -f scripts/e2e/.tmp-wipe.ts
[ "${WIPED#ERR}" = "$WIPED" ] && ok "wipe ran ($WIPED tables emptied)" || bad "wipe ran: $WIPED"
check "no students, parents, teachers, groups, invoices left" "$(M "SELECT (SELECT COUNT(*) FROM Student)+(SELECT COUNT(*) FROM Guardian)+(SELECT COUNT(*) FROM Teacher)+(SELECT COUNT(*) FROM ClassSection)+(SELECT COUNT(*) FROM FeeInvoice)+(SELECT COUNT(*) FROM AdmissionRequest)")" "0"
check "only Super Admin accounts left" "$(M "SELECT COUNT(*) FROM User WHERE role<>'SUPER_ADMIN'")" "0"
check "super admin still there" "$(M "SELECT COUNT(*) FROM User WHERE role='SUPER_ADMIN'")" "$(M "SELECT COUNT(*) FROM User")"
check "one branch left: TechNova Company" "$(M "SELECT GROUP_CONCAT(name) FROM Campus")" "TechNova Company"
check "tracks/levels kept (5 / 30)" "$(M "SELECT CONCAT((SELECT COUNT(*) FROM Track),'/',(SELECT COUNT(*) FROM Level))")" "5/30"
check "batch General kept" "$(M "SELECT GROUP_CONCAT(name) FROM Batch")" "General"
check "super admin still signed in and working" "$(api GET /api/admin/setup | jq_ "d['success']")" "True"
BATCH=$(M "SELECT id FROM Batch WHERE name='General'")
check "new admission after wipe starts at TN/YYYY/0001" "$(api POST /api/students "$(stu Fresh 01077770001 '' '')" | jq_ "d['data']['registrationNumber'].endswith('/0001')")" "True"

echo "== 13. login throttling (wrong-password lockout)"
login_ip() { # id pw ip -> prints redirect Location (fresh cookie jar each time)
  local j; j=$(mktemp); local t; t=$(curl -s -c "$j" -b "$j" -H "X-Forwarded-For: $3" $B/api/auth/csrf | jq_ "d['csrfToken']")
  curl -s -o /dev/null -D - -c "$j" -b "$j" -H "X-Forwarded-For: $3" -X POST $B/api/auth/callback/credentials --data-urlencode "csrfToken=$t" --data-urlencode "email=$1" --data-urlencode "password=$2" --data-urlencode "callbackUrl=$B/dashboard" | grep -i '^location' | tr -d '\r'; rm -f "$j"
}
M "DELETE FROM LoginAttempt"
for i in 1 2 3 4 5; do L=$(login_ip "$SA_EMAIL" "Wrong$i-pass" 10.0.0.1); done
case "$L" in *too_many_attempts*) bad "5th wrong password is still a normal 'wrong password'";; *error=*) ok "5th wrong password is still a normal 'wrong password'";; *) bad "5th wrong password rejected ($L)";; esac
check "5 failures recorded for the account" "$(M "SELECT COUNT(*) FROM LoginAttempt WHERE identifier=LOWER('$SA_EMAIL')")" "5"
case "$(login_ip "$SA_EMAIL" E2eAdmin123 10.0.0.2)" in *too_many_attempts*) ok "account locked: even the RIGHT password from another device is paused";; *) bad "account locked after 5 wrong passwords";; esac
check "Super Admin sees the locked account" "$(api GET /api/admin/login-locks | jq_ "len([l for l in d['data']['locks'] if l['kind']=='account' and l['value']=='$(echo "$SA_EMAIL" | tr 'A-Z' 'a-z')'])")" "1"
check "unlock refused without login" "$(curl -s -X POST -H 'Content-Type: application/json' -d '{"kind":"account","value":"x"}' $B/api/admin/login-locks | jq_ "d['success']")" "False"
check "Super Admin unlocks it" "$(api POST /api/admin/login-locks "{\"kind\":\"account\",\"value\":\"$(echo "$SA_EMAIL" | tr 'A-Z' 'a-z')\"}" | jq_ "d['success']")" "True"
case "$(login_ip "$SA_EMAIL" E2eAdmin123 10.0.0.2)" in *error=*) bad "right password works after unlock";; *) ok "right password works after unlock";; esac
for i in 1 2 3 4 5 6 7 8 9 10; do login_ip "nobody$i@example.com" "Wrong-pass$i" 10.0.0.9 >/dev/null; done
case "$(login_ip "$SA_EMAIL" E2eAdmin123 10.0.0.9)" in *too_many_attempts*) ok "device locked after 10 wrong attempts on different accounts";; *) bad "device locked after 10 wrong attempts";; esac
case "$(login_ip "$SA_EMAIL" E2eAdmin123 10.0.0.3)" in *error=*) bad "other devices unaffected by that device's lock";; *) ok "other devices unaffected by that device's lock";; esac
check "a successful sign-in clears the account's counter" "$(M "SELECT COUNT(*) FROM LoginAttempt WHERE identifier=LOWER('$SA_EMAIL')")" "0"
SAKEY=$(echo "$SA_EMAIL" | tr 'A-Z' 'a-z')
for s in 930 720 480 240 60; do M "INSERT INTO LoginAttempt (id, identifier, ip, createdAt) VALUES ('slow-$s','$SAKEY','10.0.0.60', NOW(3) - INTERVAL $s SECOND)"; done
case "$(login_ip "$SA_EMAIL" E2eAdmin123 10.0.0.61)" in *too_many_attempts*) ok "slow typing: 5 wrong over ~15 min still locks (15 min from the LAST one)";; *) bad "slow typing: lock counted from the last wrong password";; esac
check "unlock after slow-typing lock" "$(api POST /api/admin/login-locks "{\"kind\":\"account\",\"value\":\"$SAKEY\"}" | jq_ "d['success']")" "True"
M "INSERT INTO LoginAttempt (id, identifier, ip, createdAt) VALUES ('old-attempt','old@example.com','10.0.0.50', NOW(3) - INTERVAL 2 DAY)"
login_ip "nobody@example.com" "Wrong-pass" 10.0.0.51 >/dev/null
check "attempts older than a day are removed" "$(M "SELECT COUNT(*) FROM LoginAttempt WHERE id='old-attempt'")" "0"

echo "== 14. temporary portal password (student page)"
PS=$(api POST /api/students "$(stu Portal 01077770002 Mona 01077770003)" | jq_ "d['data']['id']")
PG=$(M "SELECT g.id FROM Guardian g JOIN _GuardianToStudent gs ON gs.A=g.id WHERE gs.B='$PS'")
PGKEY=$(M "SELECT LOWER(u.email) FROM Guardian g JOIN User u ON u.id=g.userId WHERE g.id='$PG'")
check "refused without login" "$(curl -s -X POST -H 'Content-Type: application/json' -d '{"target":"student"}' $B/api/students/$PS/portal-password | jq_ "d['success']")" "False"
check "parent not linked to this student -> refused" "$(api POST /api/students/$PS/portal-password '{"target":"guardian","guardianId":"not-a-parent"}' | jq_ "d['success']")" "False"
for s in 1 2 3 4 5; do M "INSERT INTO LoginAttempt (id, identifier, ip, createdAt) VALUES ('pg-$s','$PGKEY','10.0.0.70', NOW(3))"; done
R=$(api POST /api/students/$PS/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$PG\"}")
PW=$(echo "$R" | jq_ "d['data']['password']")
check "parent password issued" "$(echo "$R" | jq_ "d['success']")" "True"
[[ "$PW" =~ ^[A-Z][a-z]+-[0-9]{4}-[A-Z][a-z]+$ ]] && ok "password looks like Word-1234-Word" || bad "password format ($PW)"
check "parent logs in with the phone number" "$(echo "$R" | jq_ "d['data']['loginId']")" "01077770003"
check "WhatsApp number in international form" "$(echo "$R" | jq_ "d['data']['whatsappTo']")" "201077770003"
check "ready message contains the password" "$(echo "$R" | jq_ "'$PW' in d['data']['message']")" "True"
check "parent must change it at first sign-in" "$(M "SELECT u.mustChangePassword FROM Guardian g JOIN User u ON u.id=g.userId WHERE g.id='$PG'")" "1"
check "issuing it cleared the parent's sign-in lock" "$(M "SELECT COUNT(*) FROM LoginAttempt WHERE identifier='$PGKEY'")" "0"
check "password never stored in the audit log" "$(M "SELECT COUNT(*) FROM AuditLog WHERE CAST(changes AS CHAR) LIKE '%$PW%'")" "0"
case "$(login_ip 01077770003 "$PW" 10.0.0.71)" in *error=*) bad "parent signs in with phone + temporary password";; *) ok "parent signs in with phone + temporary password";; esac
case "$(login_ip 01077770003 01077770003 10.0.0.72)" in *error=*) ok "default password (the phone) still refused";; *) bad "default password (the phone) still refused";; esac
R=$(api POST /api/students/$PS/portal-password '{"target":"student"}')
SPW=$(echo "$R" | jq_ "d['data']['password']"); SLOGIN=$(echo "$R" | jq_ "d['data']['loginId']")
check "student password issued" "$(echo "$R" | jq_ "d['success']")" "True"
case "$(login_ip "$SLOGIN" "$SPW" 10.0.0.73)" in *error=*) bad "student signs in with the temporary password";; *) ok "student signs in with the temporary password";; esac
check "old parent password stops working after a new one" "$(R2=$(api POST /api/students/$PS/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$PG\"}"); case "$(login_ip 01077770003 "$PW" 10.0.0.74)" in *error=*) echo yes;; *) echo no;; esac)" "yes"

echo "== 15. security hardening"
login_jar() { # id pw jar ip
  local t; t=$(curl -s -c "$3" -b "$3" -H "X-Forwarded-For: $4" $B/api/auth/csrf | jq_ "d['csrfToken']")
  curl -s -o /dev/null -c "$3" -b "$3" -H "X-Forwarded-For: $4" -X POST $B/api/auth/callback/credentials --data-urlencode "csrfToken=$t" --data-urlencode "email=$1" --data-urlencode "password=$2" --data-urlencode "callbackUrl=$B/dashboard"
}
code_with() { curl -s -o /dev/null -w '%{http_code}' -b "$1" "$B$2"; }
PJ=$(mktemp); SJ=$(mktemp)
PW3=$(api POST /api/students/$PS/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$PG\"}" | jq_ "d['data']['password']")
SPW3=$(api POST /api/students/$PS/portal-password '{"target":"student"}' | jq_ "d['data']['password']")
login_jar 01077770003 "$PW3" "$PJ" 10.0.0.81
login_jar "$SLOGIN" "$SPW3" "$SJ" 10.0.0.82
check "parent session works" "$(code_with "$PJ" /api/me/permissions)" "200"
check "student session works" "$(code_with "$SJ" /api/me/permissions)" "200"
check "student cannot get an upload signature for staff folders" "$(code_with "$SJ" '/api/upload?folder=students')" "403"
[ "$(code_with "$SJ" '/api/upload?folder=challans')" != "403" ] && ok "student may still upload payment proofs" || bad "student may still upload payment proofs"
check "unknown upload folder refused" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$B/api/upload?folder=misc")" "400"
PGUSER=$(M "SELECT userId FROM Guardian WHERE id='$PG'")
M "UPDATE User SET isActive=0 WHERE id='$PGUSER'"
api POST /api/students/$PS/portal-password '{"target":"student"}' >/dev/null
check "new temporary password recorded a revocation time" "$(M "SELECT sessionsRevokedAt IS NOT NULL FROM User u JOIN Student s ON s.userId=u.id WHERE s.id='$PS'")" "1"
sleep 32 # session state is cached for 30 s per user
check "deactivated parent is signed out at once (not after 8 h)" "$(code_with "$PJ" /api/me/permissions)" "401"
check "old student session signed out after a password reset" "$(code_with "$SJ" /api/me/permissions)" "401"
check "super admin (untouched) still signed in" "$(code_with "$JAR" /api/me/permissions)" "200"
M "UPDATE User SET isActive=1 WHERE id='$PGUSER'"
rm -f "$PJ" "$SJ"
FP=""; for i in $(seq 1 11); do FP=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.0.90' -d '{"email":"nobody@example.com"}' $B/api/auth/forgot-password); done
check "forgot-password limited (11th request from one device)" "$FP" "429"
check "a different device can still ask for a reset" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.0.91' -d '{"email":"nobody@example.com"}' $B/api/auth/forgot-password)" "200"
VC=""; for i in $(seq 1 61); do VC=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 10.0.0.92' "$B/api/verify?id=TN-CERT-2026-0000$i"); done
check "certificate verification limited (61st lookup in 10 min)" "$VC" "429"
check "dangerous run-migration endpoint removed" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/admin/run-migration?secret=x")" "404"
check "CV download needs login" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/staff-applications/x/cv")" "401"

echo "== 16. payment settings"
FS=$(api GET /api/admin/finance-settings)
check "default payment methods created (Cash, InstaPay, Vodafone Cash...)" "$(echo "$FS" | jq_ "','.join(m['name'] for m in d['data']['methods'])")" "Cash,InstaPay,Vodafone Cash,Bank Transfer,Fawry,Cheque"
METHODS=$(echo "$FS" | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(json.dumps([{'id':m['id'],'name':m['name'],'isActive':m['isActive']} for m in d['methods']]))")
SAVE=$(api PUT /api/admin/finance-settings "{\"finance\":{\"invoiceDueDays\":7},\"accounts\":[{\"kind\":\"INSTAPAY\",\"label\":\"InstaPay\",\"accountNumber\":\"technova@instapay\",\"accountName\":\"TechNova\",\"isActive\":true}],\"methods\":$METHODS}")
check "payment settings saved" "$(echo "$SAVE" | jq_ "d['success']")" "True"
NOSYS=$(echo "$METHODS" | python -c "import sys,json;print(json.dumps([m for m in json.load(sys.stdin) if m['name']!='Cash']))")
check "built-in method (Cash) cannot be removed" "$(api PUT /api/admin/finance-settings "{\"finance\":{\"invoiceDueDays\":7},\"accounts\":[],\"methods\":$NOSYS}" | jq_ "d['success']")" "False"
check "parents see the configured account" "$(api GET /api/payment-accounts | jq_ "'technova@instapay' in (d['data']['snapshot'] or '')")" "True"

echo "== 17. discounts (every scenario through the real API)"
NLEVEL=$(M "SELECT l.id FROM Level l JOIN AcademicSubject s ON s.id=l.subjectId WHERE s.code LIKE 'NOVA-%' ORDER BY s.code, l.\`order\` LIMIT 1")
NTRACK=$(M "SELECT s.trackId FROM Level l JOIN AcademicSubject s ON s.id=l.subjectId WHERE l.id='$NLEVEL'")
OLEVEL=$(M "SELECT l.id FROM Level l JOIN AcademicSubject s ON s.id=l.subjectId WHERE s.code LIKE 'NOVA-%' AND s.trackId<>'$NTRACK' ORDER BY s.code, l.\`order\` LIMIT 1")
mkgroup() { api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"batchId\":\"$BATCH\",\"shiftId\":\"$SHIFT\",\"className\":\"$1\",\"sectionName\":\"D\",\"levelId\":\"$2\"}" >/dev/null; M "SELECT id FROM ClassSection WHERE className='$1'"; }
DG=$(mkgroup "E2E Disc" "$NLEVEL"); DG2=$(mkgroup "E2E Disc Other" "$OLEVEL")
[ -n "$DG" ] && [ -n "$DG2" ] && ok "two Nova groups created (850 EGP/month)" || bad "groups for discounts"
api PUT /api/discounts/rules '{"allowStacking":true,"maxTotalPercent":50,"siblingAppliesTo":"SECOND_AND_LATER"}' >/dev/null
TODAY=$(date +%F); YESTERDAY=$(date -d yesterday +%F); LATER=$(date -d '+30 days' +%F); LASTWEEK=$(date -d '-7 days' +%F)
mktype() { api POST /api/discount-types "$1" | jq_ "d['data']['id']"; }
T_MAN=$(mktype '{"name":"Manual","kind":"MANUAL","valueType":"PERCENT","value":10,"editableValue":true,"maxValue":30,"duration":"EVERY_CYCLE","approvalMode":"STAFF","stackable":true}')
T_SIB=$(mktype '{"name":"Siblings","kind":"SIBLING","valueType":"PERCENT","value":10,"duration":"EVERY_CYCLE","autoApply":true,"approvalMode":"STAFF","stackable":true}')
T_PROMO=$(mktype "{\"name\":\"Track offer\",\"kind\":\"PROMO\",\"valueType\":\"FIXED\",\"value\":100,\"duration\":\"FIRST_CYCLE\",\"autoApply\":true,\"approvalMode\":\"STAFF\",\"scopeType\":\"TRACK\",\"scopeId\":\"$NTRACK\",\"validFrom\":\"$YESTERDAY\",\"validTo\":\"$LATER\",\"stackable\":true}")
T_OLD=$(mktype "{\"name\":\"Old offer\",\"kind\":\"PROMO\",\"valueType\":\"FIXED\",\"value\":200,\"duration\":\"EVERY_CYCLE\",\"autoApply\":true,\"approvalMode\":\"STAFF\",\"validFrom\":\"$LASTWEEK\",\"validTo\":\"$YESTERDAY\",\"stackable\":true}")
T_VIP=$(mktype '{"name":"VIP","kind":"MANUAL","valueType":"PERCENT","value":40,"duration":"EVERY_CYCLE","approvalMode":"MANAGER","stackable":false}')
T_APPR=$(mktype '{"name":"Needs approval","kind":"OTHER","valueType":"PERCENT","value":20,"duration":"EVERY_CYCLE","approvalMode":"STAFF_WITH_APPROVAL","stackable":true}')
T_FREE=$(mktype '{"name":"Full scholarship","kind":"MANUAL","valueType":"PERCENT","value":100,"duration":"EVERY_CYCLE","approvalMode":"STAFF","stackable":true}')
check "a percentage over 100 is refused" "$(api POST /api/discount-types '{"name":"Bad","kind":"MANUAL","valueType":"PERCENT","value":120,"duration":"EVERY_CYCLE","approvalMode":"STAFF"}' | jq_ "d['success']")" "False"
check "7 discount types created" "$(M "SELECT COUNT(*) FROM DiscountType")" "7"
mkstu() { api POST /api/students "$(stu "$1" "$2" "$3" "$4")" | jq_ "d['data']['id']"; }
S1=$(mkstu Sib1 01066660001 Karim 01066660009); S2=$(mkstu Sib2 01066660002 Karim 01066660009); SOLO=$(mkstu Solo 01066660003 '' '')
inv() { M "SELECT CONCAT(CAST(subtotal AS DOUBLE),'/',CAST(discount AS DOUBLE),'/',CAST(totalAmount AS DOUBLE),'/',status) FROM FeeInvoice WHERE studentId='$1' AND classSectionId='$2' ORDER BY createdAt DESC LIMIT 1"; }
invid() { M "SELECT id FROM FeeInvoice WHERE studentId='$1' AND classSectionId='$2' ORDER BY createdAt DESC LIMIT 1"; }
api POST /api/groups/$DG/students "{\"studentId\":\"$S1\"}" >/dev/null
check "first child: track offer only (first month), no sibling discount yet -> 850-100" "$(inv $S1 $DG)" "850/100/750/ISSUED"
check "expired offer never applied" "$(M "SELECT COUNT(*) FROM InvoiceDiscount WHERE discountTypeId='$T_OLD'")" "0"
check "new invoice number TN-INV-YYYY-NNNNN" "$(M "SELECT challanNumber LIKE 'TN-INV-____-_____' FROM FeeInvoice WHERE id='$(invid $S1 $DG)'")" "1"
check "due 7 days after issue (setting)" "$(M "SELECT DATEDIFF(dueDate, createdAt) FROM FeeInvoice WHERE id='$(invid $S1 $DG)'")" "7"
check "invoice shows the configured account (not the old template one)" "$(api GET /api/fees/$(invid $S1 $DG) | jq_ "'technova@instapay' in d['data']['bankAccounts'] and 'Ali Aslam' not in d['data']['bankAccounts']")" "True"
api POST /api/groups/$DG/students "{\"studentId\":\"$S2\"}" >/dev/null
check "second child: offer 100 + sibling 10% (85), both on the base price" "$(inv $S2 $DG)" "850/185/665/ISSUED"
check "two discount lines recorded for the second child" "$(M "SELECT COUNT(*) FROM InvoiceDiscount WHERE invoiceId='$(invid $S2 $DG)'")" "2"
check "invoice page lists the discount breakdown" "$(api GET /api/fees/$(invid $S2 $DG) | jq_ "len(d['data']['discountLines'])")" "2"
api POST /api/groups/$DG2/students "{\"studentId\":\"$SOLO\"}" >/dev/null
check "offer limited to another track does not apply" "$(inv $SOLO $DG2)" "850/0/850/ISSUED"
check "manual value above its maximum (50% > 30%) refused" "$(api POST /api/discounts "{\"discountTypeId\":\"$T_MAN\",\"studentId\":\"$SOLO\",\"value\":50}" | jq_ "d['success']")" "False"
R=$(api POST /api/discounts "{\"discountTypeId\":\"$T_MAN\",\"studentId\":\"$SOLO\",\"value\":20,\"reason\":\"e2e\"}")
A_MAN=$(echo "$R" | jq_ "d['data']['assignment']['id']")
check "manual 20% given (active at once)" "$(echo "$R" | jq_ "d['data']['assignment']['status']")" "ACTIVE"
check "system ASKS about the current unpaid invoice" "$(echo "$R" | jq_ "len(d['data']['affectedInvoices'])")" "1"
check "nothing changed before answering" "$(inv $SOLO $DG2)" "850/0/850/ISSUED"
api POST /api/discounts/$A_MAN/apply "{\"invoiceIds\":[\"$(invid $SOLO $DG2)\"]}" >/dev/null
check "applied to the current invoice after 'yes'" "$(inv $SOLO $DG2)" "850/170/680/ISSUED"
R=$(api POST /api/discounts "{\"discountTypeId\":\"$T_VIP\",\"studentId\":\"$SOLO\"}"); A_VIP=$(echo "$R" | jq_ "d['data']['assignment']['id']")
api POST /api/discounts/$A_VIP/apply "{\"invoiceIds\":[\"$(invid $SOLO $DG2)\"]}" >/dev/null
check "non-combinable VIP 40% applies alone (better than manual 20%)" "$(inv $SOLO $DG2)" "850/340/510/ISSUED"
api PUT /api/discounts/rules '{"allowStacking":true,"maxTotalPercent":30,"siblingAppliesTo":"SECOND_AND_LATER"}' >/dev/null
api POST /api/discounts/$A_VIP/apply "{\"invoiceIds\":[\"$(invid $SOLO $DG2)\"]}" >/dev/null
check "maximum total 30% from settings caps it (255)" "$(inv $SOLO $DG2)" "850/255/595/ISSUED"
api PUT /api/discounts/rules '{"allowStacking":false,"maxTotalPercent":50,"siblingAppliesTo":"SECOND_AND_LATER"}' >/dev/null
R=$(api POST /api/discounts "{\"discountTypeId\":\"$T_MAN\",\"studentId\":\"$S2\",\"value\":5}"); A_S2=$(echo "$R" | jq_ "d['data']['assignment']['id']")
api POST /api/discounts/$A_S2/apply "{\"invoiceIds\":[\"$(invid $S2 $DG)\"]}" >/dev/null
check "combining OFF in settings: only the biggest single discount (offer 100)" "$(inv $S2 $DG)" "850/100/750/ISSUED"
api PUT /api/discounts/rules '{"allowStacking":true,"maxTotalPercent":50,"siblingAppliesTo":"ALL"}' >/dev/null
api POST /api/discounts/$A_S2/apply "{\"invoiceIds\":[\"$(invid $S2 $DG)\"]}" >/dev/null
check "combining ON again: offer 100 + sibling 85 + manual 42.5" "$(inv $S2 $DG)" "850/227.5/622.5/ISSUED"
FIRSTPAID=$(M "SELECT id FROM FeeInvoice WHERE id='$(invid $S1 $DG)'")
api POST /api/fees/$FIRSTPAID/payments '{"amount":100,"paymentMethod":"Bitcoin"}' >/dev/null
check "unknown payment method refused" "$(api POST /api/fees/$FIRSTPAID/payments '{"amount":100,"paymentMethod":"Bitcoin"}' | jq_ "d['success']")" "False"
check "a method from settings (InstaPay) accepted" "$(api POST /api/fees/$FIRSTPAID/payments '{"amount":750,"paymentMethod":"InstaPay"}' | jq_ "d['success']")" "True"
R=$(api POST /api/discounts "{\"discountTypeId\":\"$T_MAN\",\"studentId\":\"$S1\",\"value\":10}")
check "a fully paid invoice is not offered for a new discount" "$(echo "$R" | jq_ "len(d['data']['affectedInvoices'])")" "0"
R=$(api POST /api/discounts "{\"discountTypeId\":\"$T_MAN\",\"classSectionId\":\"$DG\",\"value\":10,\"reason\":\"group offer\"}")
check "whole-group discount given" "$(echo "$R" | jq_ "d['data']['assignment']['status']")" "ACTIVE"
LATE=$(mkstu Late 01066660004 '' ''); api POST /api/groups/$DG/students "{\"studentId\":\"$LATE\"}" >/dev/null
check "student added LATER to the group gets the group discount (+ first-month offer)" "$(inv $LATE $DG)" "850/185/665/ISSUED"
FREE=$(mkstu Free 01066660005 '' '')
api POST /api/discounts "{\"discountTypeId\":\"$T_FREE\",\"studentId\":\"$FREE\"}" >/dev/null
api PUT /api/discounts/rules '{"allowStacking":true,"maxTotalPercent":null,"siblingAppliesTo":"ALL"}' >/dev/null
api POST /api/groups/$DG2/students "{\"studentId\":\"$FREE\"}" >/dev/null
check "100% scholarship: nothing to pay, invoice PAID at once" "$(inv $FREE $DG2)" "850/850/0/PAID"
cat > scripts/e2e/.tmp-sec.ts <<'EOS'
import { prisma } from '../../lib/prisma'
import { hash } from '@node-rs/argon2'
async function main() {
  await prisma.user.create({ data: { email: 'sec@e2e.local', passwordHash: await hash('E2eSec12345'), role: 'SECRETARY', isActive: true } })
  await prisma.$disconnect()
}
main()
EOS
DATABASE_URL="$URL" npx tsx scripts/e2e/.tmp-sec.ts >/dev/null 2>&1; rm -f scripts/e2e/.tmp-sec.ts
SECJ=$(mktemp); login_jar sec@e2e.local E2eSec12345 "$SECJ" 10.0.0.95
secapi() { curl -s -b "$SECJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
R=$(secapi POST /api/discounts "{\"discountTypeId\":\"$T_APPR\",\"studentId\":\"$SOLO\",\"reason\":\"needs ok\"}")
A_APPR=$(echo "$R" | jq_ "d['data']['assignment']['id']")
check "secretary: discount needing approval goes PENDING" "$(echo "$R" | jq_ "d['data']['assignment']['status']")" "PENDING"
check "every approver gets a notification" "$(M "SELECT COUNT(*) FROM Notification WHERE type='DISCOUNT_REQUEST' AND relatedId='$A_APPR'")" "$(M "SELECT COUNT(*) FROM User WHERE isActive=1 AND role IN ('SUPER_ADMIN','ADMIN','BRANCH_MANAGER')")"
check "pending discount not applied to invoices yet" "$(M "SELECT COUNT(*) FROM InvoiceDiscount WHERE assignmentId='$A_APPR'")" "0"
check "secretary cannot approve" "$(secapi PATCH /api/discounts/$A_APPR '{"action":"approve"}' | jq_ "d['success']")" "False"
check "secretary cannot give a manager-only discount" "$(secapi POST /api/discounts "{\"discountTypeId\":\"$T_VIP\",\"studentId\":\"$SOLO\"}" | jq_ "d['success']")" "False"
R=$(api PATCH /api/discounts/$A_APPR '{"action":"approve"}')
check "manager approves" "$(echo "$R" | jq_ "d['data']['assignment']['status']")" "ACTIVE"
check "after approval the system asks about the unpaid invoice" "$(echo "$R" | jq_ "len(d['data']['affectedInvoices'])")" "1"
check "requester notified of the approval" "$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.email='sec@e2e.local' AND n.relatedId='$A_APPR'")" "1"
check "an approved request cannot be approved twice" "$(api PATCH /api/discounts/$A_APPR '{"action":"approve"}' | jq_ "d['success']")" "False"
R=$(secapi POST /api/discounts "{\"discountTypeId\":\"$T_APPR\",\"studentId\":\"$S1\"}"); A_REJ=$(echo "$R" | jq_ "d['data']['assignment']['id']")
check "manager rejects with a reason" "$(api PATCH /api/discounts/$A_REJ '{"action":"reject","reason":"not eligible"}' | jq_ "d['data']['assignment']['status']")" "REJECTED"
check "stop a discount" "$(api PATCH /api/discounts/$A_MAN '{"action":"end"}' | jq_ "d['data']['assignment']['status']")" "ENDED"
check "used type is switched off instead of deleted" "$(api DELETE /api/discount-types/$T_PROMO | jq_ "d['data'].get('deactivated')")" "True"
check "unused type is really deleted" "$(api DELETE /api/discount-types/$T_OLD | jq_ "d['data'].get('deleted')")" "True"
REP=$(api GET "/api/discounts/report?from=$TODAY&to=$TODAY")
check "report total = sum of discount lines" "$(echo "$REP" | jq_ "d['data']['total']")" "$(M "SELECT CAST(ROUND(SUM(d.amount),2) AS DOUBLE) FROM InvoiceDiscount d JOIN FeeInvoice f ON f.id=d.invoiceId WHERE f.status<>'CANCELLED'")"
check "report splits by type" "$(echo "$REP" | jq_ "len(d['data']['byType'])>=4")" "True"
check "student absence fines switched off" "$(grep -c 'STUDENT_ABSENCE_PENALTIES_ENABLED = false' lib/penalties/assessments.ts)" "1"
echo "== 18. one payment path + receipts + printer settings"
check "only ONE place in the code creates payments" "$(grep -rl 'feePayment.create' app lib | wc -l | tr -d ' ')" "1"
PAY1=$(M "SELECT id FROM FeePayment WHERE invoiceId='$FIRSTPAID' AND status='COMPLETED' ORDER BY createdAt DESC LIMIT 1")
check "payment got a receipt number TN-RCPT-YYYY-NNNNN" "$(M "SELECT receiptNumber LIKE 'TN-RCPT-____-_____' FROM FeePayment WHERE id='$PAY1'")" "1"
check "payment source recorded (STAFF)" "$(M "SELECT source FROM FeePayment WHERE id='$PAY1'")" "STAFF"
RC=$(api GET /api/payments/$PAY1/receipt)
check "receipt: amount and remaining balance" "$(echo "$RC" | jq_ "str(d['data']['amount'])+'/'+str(d['data']['invoice']['remaining'])")" "750/0"
check "receipt: WhatsApp goes to the parent's number" "$(echo "$RC" | jq_ "d['data']['whatsappTo']")" "201066660009"
check "receipt text is ready for WhatsApp" "$(echo "$RC" | jq_ "d['data']['receiptNumber'] in d['data']['text']")" "True"
LATEINV=$(invid $LATE $DG)
R=$(api POST /api/fees/$LATEINV/payments '{"amount":665,"paymentMethod":"Cash"}')
PAY2=$(echo "$R" | jq_ "d['data']['id']")
check "payment response returns the receipt number" "$(echo "$R" | jq_ "d['data']['receiptNumber'].startswith('TN-RCPT-')")" "True"
check "receipt numbers go up (no repeats)" "$(M "SELECT COUNT(DISTINCT receiptNumber)=COUNT(receiptNumber) FROM FeePayment WHERE receiptNumber IS NOT NULL")" "1"
G1=$(M "SELECT g.id FROM Guardian g JOIN _GuardianToStudent gs ON gs.A=g.id WHERE gs.B='$S1'")
TPW=$(api POST /api/students/$S1/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$G1\"}" | jq_ "d['data']['password']")
PJ2=$(mktemp); login_jar 01066660009 "$TPW" "$PJ2" 10.0.0.96
check "parent opens own child's receipt" "$(code_with "$PJ2" /api/payments/$PAY1/receipt)" "200"
check "parent cannot open another student's receipt" "$(code_with "$PJ2" /api/payments/$PAY2/receipt)" "403"
check "invoice page lists the payment with its receipt" "$(api GET /api/fees/$FIRSTPAID | jq_ "any(p['id']=='$PAY1' and p['receiptNumber'] for p in d['data']['payments'])")" "True"
rm -f "$PJ2"
FS2=$(api GET /api/admin/finance-settings)
F58=$(echo "$FS2" | python -c "import sys,json;d=json.load(sys.stdin)['data'];f=d['finance'];f['receiptPaper']='58mm';f['receiptAfterPayment']='PRINT';f['companyPhone']='01000000000';print(json.dumps({'finance':f,'accounts':d['accounts'],'methods':[{'id':m['id'],'name':m['name'],'isActive':m['isActive']} for m in d['methods']]}))")
check "printer paper set to 58 mm" "$(api PUT /api/admin/finance-settings "$F58" | jq_ "d['data']['finance']['receiptPaper']")" "58mm"
check "receipt uses the printer setting" "$(api GET /api/payments/$PAY1/receipt | jq_ "d['data']['company']['receiptPaper']+'/'+d['data']['company']['companyPhone']")" "58mm/01000000000"
check "staff screen knows to open+print after a payment" "$(api GET /api/payment-accounts | jq_ "d['data']['receiptAfterPayment']")" "PRINT"
FAUTO=$(echo "$F58" | python -c "import sys,json;d=json.load(sys.stdin);d['finance']['autoSendReceiptWhatsApp']=True;print(json.dumps(d))")
check "automatic WhatsApp refused until the Business API is connected" "$(api PUT /api/admin/finance-settings "$FAUTO" | jq_ "d['success']")" "False"
echo "== 19. refunds + student wallet"
api PUT /api/refunds/rules '{"rules":[{"scopeType":"ALL","allowed":true,"adminFeeType":"FIXED","adminFeeValue":50,"deductBasis":"ATTENDED"}]}' >/dev/null
SG=$(api GET "/api/refunds/suggest?invoiceId=$LATEINV")
check "suggestion with no session attended: 665 paid - 50 admin fee" "$(echo "$SG" | jq_ "str(d['data']['netPaid'])+'/'+str(d['data']['deduction'])+'/'+str(d['data']['adminFee'])+'/'+str(d['data']['suggested'])")" "665/0/50/615"
LATEENR=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LATE' AND classSectionId='$DG'")
sess $DG 2026-02-01 "$(rec $LATEENR PRESENT)" >/dev/null
SG=$(api GET "/api/refunds/suggest?invoiceId=$LATEINV")
check "one attended session deducted (665/4 = 166.25): 665 - 166.25 - 50" "$(echo "$SG" | jq_ "str(d['data']['perSession'])+'/'+str(d['data']['suggested'])")" "166.25/448.75"
check "secretary (view only) cannot request a refund" "$(secapi POST /api/refunds "{\"invoiceId\":\"$LATEINV\",\"amount\":100,\"method\":\"WALLET\"}" | jq_ "d['success']")" "False"
ACCE=refund-acc@e2e.local
api POST /api/users/create-accountant "{\"firstName\":\"Refund\",\"lastName\":\"Accountant\",\"email\":\"$ACCE\",\"password\":\"E2eAcc12345\",\"phoneNumber\":\"01055550001\",\"campusId\":\"$CAMPUS\"}" >/dev/null
ACJ=$(mktemp); login_jar $ACCE E2eAcc12345 "$ACJ" 10.0.0.97
accapi() { curl -s -b "$ACJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
check "more than what was paid is refused" "$(accapi POST /api/refunds "{\"invoiceId\":\"$LATEINV\",\"amount\":1000,\"method\":\"WALLET\"}" | jq_ "d['success']")" "False"
R=$(accapi POST /api/refunds "{\"invoiceId\":\"$LATEINV\",\"amount\":448.75,\"method\":\"WALLET\",\"withdrawStudent\":true,\"reason\":\"moving away\"}")
RF1=$(echo "$R" | jq_ "d['data']['refundId']")
check "accountant request goes PENDING" "$(echo "$R" | jq_ "d['data']['status']")" "PENDING"
check "approvers notified" "$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='REFUND_REQUEST' AND relatedId='$RF1'")" "1"
check "nothing refunded before approval" "$(M "SELECT CAST(refundedAmount AS DOUBLE) FROM FeeInvoice WHERE id='$LATEINV'")" "0"
check "accountant cannot approve" "$(accapi PATCH /api/refunds/$RF1 '{"action":"approve"}' | jq_ "d['success']")" "False"
R=$(api PATCH /api/refunds/$RF1 '{"action":"approve"}')
check "manager approves" "$(echo "$R" | jq_ "d['data']['status']")" "APPROVED"
check "refund number TN-RFND-YYYY-NNNNN" "$(M "SELECT refundNumber LIKE 'TN-RFND-____-_____' FROM Refund WHERE id='$RF1'")" "1"
check "invoice shows the refunded amount" "$(M "SELECT CAST(refundedAmount AS DOUBLE) FROM FeeInvoice WHERE id='$LATEINV'")" "448.75"
check "credit landed in the student wallet" "$(api GET /api/students/$LATE/wallet | jq_ "d['data']['balance']")" "448.75"
check "student removed from the group (asked for)" "$(M "SELECT status FROM StudentEnrollment WHERE id='$LATEENR'")" "WITHDRAWN"
check "approving twice is refused" "$(api PATCH /api/refunds/$RF1 '{"action":"approve"}' | jq_ "d['success']")" "False"
check "refund receipt available" "$(api GET /api/refunds/$RF1 | jq_ "d['data']['refundNumber'].startswith('TN-RFND-')")" "True"
check "accountant's next request can't exceed what is left" "$(accapi POST /api/refunds "{\"invoiceId\":\"$LATEINV\",\"amount\":300,\"method\":\"WALLET\"}" | jq_ "d['success']")" "False"
M "UPDATE ClassSection SET installmentsAllowed=1 WHERE id='$DG2'"
api POST /api/groups/$DG2/students "{\"studentId\":\"$LATE\"}" >/dev/null
LATE2=$(invid $LATE $DG2)
check "next invoice paid automatically from the wallet (448.75, phase B)" "$(M "SELECT CAST(SUM(amount) AS DOUBLE) FROM FeePayment WHERE invoiceId='$LATE2' AND source='WALLET'")" "448.75"
check "wallet payment has a receipt and source WALLET" "$(M "SELECT CONCAT(source,'/',receiptNumber LIKE 'TN-RCPT-%') FROM FeePayment WHERE invoiceId='$LATE2'")" "WALLET/1"
check "wallet is now empty" "$(api GET /api/students/$LATE/wallet | jq_ "d['data']['balance']")" "0"
check "paying from an empty wallet is refused" "$(api POST /api/fees/$LATE2/pay-from-wallet '{}' | jq_ "d['success']")" "False"
api PUT /api/refunds/rules "{\"rules\":[{\"scopeType\":\"ALL\",\"allowed\":true,\"adminFeeType\":\"FIXED\",\"adminFeeValue\":0,\"deductBasis\":\"ATTENDED\"},{\"scopeType\":\"GROUP\",\"scopeId\":\"$DG\",\"allowed\":false,\"adminFeeType\":\"FIXED\",\"adminFeeValue\":0,\"deductBasis\":\"ATTENDED\"}]}" >/dev/null
check "rule 'not allowed' for one group wins over 'everywhere'" "$(api GET "/api/refunds/suggest?invoiceId=$FIRSTPAID" | jq_ "d['data']['allowed']")" "False"
check "refund refused in that group" "$(api POST /api/refunds "{\"invoiceId\":\"$FIRSTPAID\",\"amount\":100,\"method\":\"WALLET\"}" | jq_ "d['success']")" "False"
api PUT /api/refunds/rules '{"rules":[{"scopeType":"ALL","allowed":true,"adminFeeType":"PERCENT","adminFeeValue":10,"deductBasis":"ATTENDED"}]}' >/dev/null
check "percent admin fee: 10% of 750 paid" "$(api GET "/api/refunds/suggest?invoiceId=$FIRSTPAID" | jq_ "str(d['data']['adminFee'])+'/'+str(d['data']['suggested'])")" "75/675"
R=$(api POST /api/refunds "{\"invoiceId\":\"$FIRSTPAID\",\"amount\":100,\"method\":\"CASH\",\"payoutMethod\":\"InstaPay\"}")
check "a manager's own refund is approved at once (cash back by InstaPay)" "$(echo "$R" | jq_ "d['data']['status']")" "APPROVED"
check "cash refund does not touch the wallet" "$(api GET /api/students/$S1/wallet | jq_ "d['data']['balance']")" "0"
check "cash refund needs how the money goes back" "$(api POST /api/refunds "{\"invoiceId\":\"$FIRSTPAID\",\"amount\":10,\"method\":\"CASH\"}" | jq_ "d['success']")" "False"
check "refund rules kept by the test-data wipe (settings)" "$(grep -c "'RefundRule'" lib/setup/wipe-test-data.ts)" "1"
rm -f "$ACJ"
echo "== 20. online payment (Paymob webhook, signed with a test key)"
paymob() { # reference txnId amountCents success -> "<hmac> <json body>"
python - "$@" <<'PY'
import sys, json, hmac, hashlib
ref, txn, cents, success = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4] == 'true'
obj = {"id": txn, "amount_cents": cents, "created_at": "2026-10-03T10:00:00", "currency": "EGP", "error_occured": False,
       "has_parent_transaction": False, "integration_id": 123, "is_3d_secure": True, "is_auth": False, "is_capture": False,
       "is_refunded": False, "is_standalone_payment": True, "is_voided": False, "order": {"id": 999, "merchant_order_id": ref},
       "owner": 1, "pending": False, "source_data": {"pan": "2346", "sub_type": "MasterCard", "type": "card"}, "success": success}
v = lambda x: ('true' if x else 'false') if isinstance(x, bool) else ('' if x is None else str(x))
f = [obj['amount_cents'], obj['created_at'], obj['currency'], obj['error_occured'], obj['has_parent_transaction'], obj['id'],
     obj['integration_id'], obj['is_3d_secure'], obj['is_auth'], obj['is_capture'], obj['is_refunded'], obj['is_standalone_payment'],
     obj['is_voided'], obj['order']['id'], obj['owner'], obj['pending'], obj['source_data']['pan'], obj['source_data']['sub_type'],
     obj['source_data']['type'], obj['success']]
sig = hmac.new(b'e2e-paymob-hmac', ''.join(v(x) for x in f).encode(), hashlib.sha512).hexdigest()
print(sig + ' ' + json.dumps({"type": "TRANSACTION", "obj": obj}))
PY
}
hook() { local out sig body; out=$(paymob "$@"); sig=${out%% *}; body=${out#* }; curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$body" "$B/api/webhooks/paymob?hmac=$sig"; }
S2INV=$(invid $S2 $DG)
check "'Pay online' refused while Paymob is not connected" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{}' $B/api/fees/$S2INV/pay-online)" "503"
check "parents are told online payment is off" "$(api GET /api/payment-accounts | jq_ "d['data']['onlinePayment']")" "False"
S2LEFT=$(M "SELECT CAST(ROUND((totalAmount-paidAmount)*100) AS UNSIGNED) FROM FeeInvoice WHERE id='$S2INV'")
M "INSERT INTO OnlinePayment (id, invoiceId, studentId, amount, provider, status, createdById, createdAt, updatedAt) VALUES ('op-e2e-1','$S2INV','$S2',$S2LEFT/100,'PAYMOB','PENDING','$SA_ID',NOW(3),NOW(3))"
BAD=$(paymob op-e2e-1 5001 $S2LEFT true); BADBODY=${BAD#* }
check "webhook with a wrong signature refused (401)" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$BADBODY" "$B/api/webhooks/paymob?hmac=deadbeef")" "401"
check "nothing recorded after a forged callback" "$(M "SELECT COUNT(*) FROM FeePayment WHERE invoiceId='$S2INV' AND source='ONLINE'")" "0"
check "signed success callback accepted" "$(hook op-e2e-1 5001 $S2LEFT true)" "200"
check "payment recorded automatically (source ONLINE, with receipt)" "$(M "SELECT CONCAT(COUNT(*),'/',MIN(receiptNumber LIKE 'TN-RCPT-%')) FROM FeePayment WHERE invoiceId='$S2INV' AND source='ONLINE'")" "1/1"
check "invoice PAID" "$(M "SELECT status FROM FeeInvoice WHERE id='$S2INV'")" "PAID"
check "online payment marked PAID and linked" "$(M "SELECT CONCAT(status,'/',paymentId IS NOT NULL) FROM OnlinePayment WHERE id='op-e2e-1'")" "PAID/1"
check "the same callback twice does not pay twice" "$(hook op-e2e-1 5001 $S2LEFT true)/$(M "SELECT COUNT(*) FROM FeePayment WHERE invoiceId='$S2INV' AND source='ONLINE'")" "200/1"
L2LEFT=$(M "SELECT CAST(ROUND((totalAmount-paidAmount)*100) AS UNSIGNED) FROM FeeInvoice WHERE id='$LATE2'")
M "INSERT INTO OnlinePayment (id, invoiceId, studentId, amount, provider, status, createdById, createdAt, updatedAt) VALUES ('op-e2e-2','$LATE2','$LATE',$L2LEFT/100,'PAYMOB','PENDING','$SA_ID',NOW(3),NOW(3)), ('op-e2e-3','$LATE2','$LATE',$L2LEFT/100,'PAYMOB','PENDING','$SA_ID',NOW(3),NOW(3))"
hook op-e2e-2 5002 100 true >/dev/null
check "wrong amount: kept for review, not applied" "$(M "SELECT status FROM OnlinePayment WHERE id='op-e2e-2'")/$(M "SELECT COUNT(*) FROM FeePayment WHERE invoiceId='$LATE2' AND source='ONLINE'")" "REVIEW/0"
hook op-e2e-3 5003 $L2LEFT false >/dev/null
check "declined card: marked FAILED, nothing recorded" "$(M "SELECT status FROM OnlinePayment WHERE id='op-e2e-3'")/$(M "SELECT COUNT(*) FROM FeePayment WHERE invoiceId='$LATE2' AND source='ONLINE'")" "FAILED/0"
check "staff see the payment that needs review" "$(api GET '/api/online-payments?status=REVIEW' | jq_ "any(r['id']=='op-e2e-2' for r in d['data'])")" "True"
echo "== 21. move a student to another group (money, discounts, history)"
TG1=$(mkgroup "E2E Move From" "$NLEVEL"); TG2=$(mkgroup "E2E Move Other" "$OLEVEL"); TG3=$(mkgroup "E2E Move Same" "$NLEVEL")
M "UPDATE ClassSection SET installmentsAllowed=1 WHERE id='$TG1'"
TA=$(mkstu MoveA 01066660011 '' ''); TB=$(mkstu MoveB 01066660012 '' ''); TC=$(mkstu MoveC 01066660013 '' '')
for s in $TA $TB; do api POST /api/groups/$TG1/students "{\"studentId\":\"$s\"}" >/dev/null; done
pay $(invid $TA $TG1) 850 >/dev/null; pay $(invid $TB $TG1) 100 >/dev/null
EA=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$TA' AND classSectionId='$TG1'"); EB=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$TB' AND classSectionId='$TG1'")
sess $TG1 2026-03-01 "$(rec $EA PRESENT),$(rec $EB PRESENT)" >/dev/null
sess $TG1 2026-03-03 "$(rec $EA ABSENT),$(rec $EB PRESENT)" >/dev/null
A_TG=$(api POST /api/discounts "{\"discountTypeId\":\"$T_MAN\",\"studentId\":\"$TA\",\"classSectionId\":\"$TG1\",\"value\":10}" | jq_ "d['data']['assignment']['id']")
PV=$(api GET "/api/students/$TA/transfer?from=$TG1&to=$TG2")
check "preview: paid 850, 1 session attended (850/4 = 212.5), credit 637.5" "$(echo "$PV" | jq_ "'%s/%s/%s/%s' % (d['data']['invoice']['netPaid'], d['data']['invoice']['perSession'], d['data']['invoice']['consumed'], d['data']['invoice']['credit'])")" "850/212.5/212.5/637.5"
check "preview: the group discount is listed, suggestion = move it" "$(echo "$PV" | jq_ "','.join(x['suggested'] for x in d['data']['discounts'])")" "MOVE"
check "moving without answering about the discount is refused" "$(api POST /api/students/$TA/transfer "{\"fromClassSectionId\":\"$TG1\",\"toClassSectionId\":\"$TG2\",\"creditTo\":\"NEW_INVOICE\"}" | jq_ "d['success']")" "False"
ACJ=$(mktemp); login_jar $ACCE E2eAcc12345 "$ACJ" 10.0.0.98
check "accountant (view only) cannot move students" "$(curl -s -b "$ACJ" -X POST -H 'Content-Type: application/json' -d "{\"fromClassSectionId\":\"$TG1\",\"toClassSectionId\":\"$TG2\",\"creditTo\":\"WALLET\",\"discountDecisions\":[{\"assignmentId\":\"$A_TG\",\"action\":\"MOVE\"}]}" $B/api/students/$TA/transfer | jq_ "d['success']")" "False"
rm -f "$ACJ"
R=$(secapi POST /api/students/$TA/transfer "{\"fromClassSectionId\":\"$TG1\",\"toClassSectionId\":\"$TG2\",\"creditTo\":\"NEW_INVOICE\",\"discountDecisions\":[{\"assignmentId\":\"$A_TG\",\"action\":\"MOVE\"}],\"reason\":\"another course\"}")
check "secretary moves the student to another course (credit -> new invoice)" "$(echo "$R" | jq_ "'%s/%s/%s' % (d['success'], d['data']['credit'], d['data']['creditApplied'])")" "True/637.5/637.5"
check "old enrollment withdrawn as TRANSFERRED, new one active" "$(M "SELECT CONCAT(status,'/',withdrawalReason) FROM StudentEnrollment WHERE id='$EA'")/$(M "SELECT status FROM StudentEnrollment WHERE studentId='$TA' AND classSectionId='$TG2'")" "WITHDRAWN/TRANSFERRED/ACTIVE"
check "attendance history kept on the old enrollment" "$(M "SELECT COUNT(*) FROM EnrollmentAttendanceRecord WHERE studentEnrollmentId='$EA'")" "2"
check "old invoice: 637.5 refunded, stays PAID (212.5 kept for the session)" "$(M "SELECT CONCAT(CAST(totalAmount AS DOUBLE),'/',CAST(refundedAmount AS DOUBLE),'/',status) FROM FeeInvoice WHERE id='$(invid $TA $TG1)'")" "850/637.5/PAID"
check "credit recorded as an approved refund (TN-RFND, reason group transfer)" "$(M "SELECT CONCAT(status,'/',refundNumber LIKE 'TN-RFND-%','/',reason LIKE 'Group transfer%') FROM Refund WHERE invoiceId='$(invid $TA $TG1)'")" "APPROVED/1/1"
check "discount moved with the student: new invoice 850 - 10%" "$(inv $TA $TG2)" "850/85/765/PARTIALLY_PAID"
check "credit paid onto the new invoice from the wallet, with a receipt" "$(M "SELECT CONCAT(source,'/',CAST(amount AS DOUBLE),'/',receiptNumber LIKE 'TN-RCPT-%') FROM FeePayment WHERE invoiceId='$(invid $TA $TG2)'")" "WALLET/637.5/1"
check "wallet back to zero" "$(api GET /api/students/$TA/wallet | jq_ "d['data']['balance']")" "0"
check "discount assignment now points at the new group" "$(M "SELECT classSectionId FROM DiscountAssignment WHERE id='$A_TG'")" "$TG2"
check "transfer history: 1 move, by the secretary" "$(api GET /api/students/$TA/transfer | jq_ "'%s/%s/%s' % (len(d['data']), d['data'][0]['to']['label'], d['data'][0]['by'])")" "1/E2E Move Other D/sec@e2e.local"
check "moving again from the old group is refused" "$(api POST /api/students/$TA/transfer "{\"fromClassSectionId\":\"$TG1\",\"toClassSectionId\":\"$TG3\",\"creditTo\":\"WALLET\"}" | jq_ "d['success']")" "False"
check "moving to the group they are already in is refused" "$(api POST /api/students/$TA/transfer "{\"fromClassSectionId\":\"$TG2\",\"toClassSectionId\":\"$TG2\",\"creditTo\":\"WALLET\"}" | jq_ "d['success']")" "False"
R=$(api POST /api/students/$TB/transfer "{\"fromClassSectionId\":\"$TG1\",\"toClassSectionId\":\"$TG3\",\"creditTo\":\"WALLET\"}")
check "paid less than used (100 for 2 sessions = 425): no credit" "$(echo "$R" | jq_ "'%s/%s/%s/%s' % (d['success'], d['data']['credit'], d['data']['oldInvoice']['owed'], d['data']['oldInvoice']['cancelled'])")" "True/0/325/425"
check "old invoice cut to the 2 sessions, 325 still due" "$(M "SELECT CONCAT(CAST(totalAmount AS DOUBLE),'/',CAST(paidAmount AS DOUBLE),'/',status) FROM FeeInvoice WHERE id='$(invid $TB $TG1)'")" "425/100/PARTIALLY_PAID"
check "same level, other time: new invoice issued normally" "$(inv $TB $TG3)" "850/0/850/ISSUED"
api POST /api/groups/$TG1/students "{\"studentId\":\"$TC\"}" >/dev/null
TCINV=$(invid $TC $TG1)
R=$(api POST /api/students/$TC/transfer "{\"fromClassSectionId\":\"$TG1\",\"toClassSectionId\":\"$TG2\",\"creditTo\":\"NEW_INVOICE\"}")
check "nothing paid, nothing attended: old invoice cancelled" "$(echo "$R" | jq_ "d['success']")/$(M "SELECT status FROM FeeInvoice WHERE id='$TCINV'")" "True/CANCELLED"
check "a GroupTransfer row per move" "$(M "SELECT COUNT(*) FROM GroupTransfer WHERE fromClassSectionId='$TG1'")" "3"
check "old teacher's share follows net paid (paid - refunded = 212.5 kept)" "$(M "SELECT CAST(paidAmount-refundedAmount AS DOUBLE) FROM FeeInvoice WHERE id='$(invid $TA $TG1)'")" "212.5"
echo "== 22. groups schedule (weekly / monthly calendar)"
cat > scripts/e2e/.tmp-tch.ts <<'EOS'
import { prisma } from '../../lib/prisma'
import { hash } from '@node-rs/argon2'
async function main() {
  const u = await prisma.user.create({ data: { email: 'tch@e2e.local', passwordHash: await hash('E2eTch12345'), role: 'TEACHER', isActive: true } })
  const t = await prisma.teacher.create({ data: { userId: u.id, employeeId: 'TN-TCH-E2E', firstName: 'Cal', lastName: 'Teacher', cnic: 'e2e-cnic-cal', dateOfBirth: new Date('1990-01-01'), gender: 'MALE', qualification: 'BSc', joiningDate: new Date(), phoneNumber: '01077770001', email: 'tch@e2e.local', address: 'Hurghada', city: 'Hurghada', emergencyContact: '01077770001', campusId: process.env.E2E_CAMPUS!, designation: 'Teacher' } })
  console.log(t.id); await prisma.$disconnect()
}
main()
EOS
CALT=$(DATABASE_URL="$URL" E2E_CAMPUS="$CAMPUS" npx tsx scripts/e2e/.tmp-tch.ts 2>/dev/null | tail -1); rm -f scripts/e2e/.tmp-tch.ts
[ -n "$CALT" ] && ok "a teacher for the calendar checks" || bad "a teacher for the calendar checks"
SG1=$(mkgroup "E2E Sched One" "$NLEVEL"); SG2=$(mkgroup "E2E Sched Two" "$NLEVEL")
EVERYDAY='[{"dayOfWeek":0,"time":"16:00"},{"dayOfWeek":1,"time":"16:00"},{"dayOfWeek":2,"time":"16:00"},{"dayOfWeek":3,"time":"16:00"},{"dayOfWeek":4,"time":"16:00"},{"dayOfWeek":5,"time":"16:00"},{"dayOfWeek":6,"time":"16:00"}]'
M "UPDATE ClassSection SET scheduleSlots='$EVERYDAY' WHERE id IN ('$SG1','$SG2')"
api POST /api/groups/$SG1/instructor "{\"teacherId\":\"$CALT\"}" >/dev/null
SCH=$(mkstu Sched 01066660031 '' ''); api POST /api/groups/$SG1/students "{\"studentId\":\"$SCH\"}" >/dev/null
SCHE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$SCH' AND classSectionId='$SG1'")
D() { date -u -d "$1 days" +%F; }
sess $SG1 "$(D -3)" "$(rec $SCHE PRESENT)" >/dev/null
M "INSERT INTO CancelledSession (id, classSectionId, date, reason, cancelledBy, createdAt) VALUES ('cs-e2e-1','$SG1','$(D 1)','Holiday','$SA_ID',NOW(3))"
CAL=$(api GET "/api/groups/schedule?from=$(D -5)&to=$(D 6)")
row() { echo "$CAL" | jq_ "' '.join('%s:%s:%s' % (s['date'][5:], s['status'], s['sessionNumber'] or '-') for s in d['data']['sessions'] if s['groupId']=='$1')"; }
check "held, no-attendance, cancelled and upcoming sessions on their dates (4 per cycle)" "$(row $SG1)" \
  "$(D -3 | cut -c6-):HELD:1 $(D -2 | cut -c6-):MISSING:- $(D -1 | cut -c6-):MISSING:- $(D 0 | cut -c6-):SCHEDULED:2 $(D 1 | cut -c6-):CANCELLED:- $(D 2 | cut -c6-):SCHEDULED:3 $(D 3 | cut -c6-):SCHEDULED:4"
check "last session of the cycle is flagged" "$(echo "$CAL" | jq_ "[s['date'] for s in d['data']['sessions'] if s['groupId']=='$SG1' and s['isLastOfCycle']]==['$(D 3)']")" "True"
check "cancel reason shown" "$(echo "$CAL" | jq_ "[s['cancelReason'] for s in d['data']['sessions'] if s['groupId']=='$SG1' and s['status']=='CANCELLED'][0]")" "Holiday"
check "group not started yet: faded upcoming sessions numbered from 1" "$(echo "$CAL" | jq_ "[s['sessionNumber'] for s in d['data']['sessions'] if s['groupId']=='$SG2' and s['status']=='NOT_STARTED'][:2]")" "[1, 2]"
check "no clash while the instructor has one group at 16:00" "$(echo "$CAL" | jq_ "any(s['conflict'] for s in d['data']['sessions'] if s['groupId'] in ('$SG1','$SG2'))")" "False"
api POST /api/groups/$SG2/instructor "{\"teacherId\":\"$CALT\"}" >/dev/null
CAL=$(api GET "/api/groups/schedule?from=$(D 0)&to=$(D 0)")
check "same instructor, two groups at the same time -> clash on both" "$(echo "$CAL" | jq_ "sorted(s['groupId'] for s in d['data']['sessions'] if s['conflict'] and s['groupId'] in ('$SG1','$SG2'))==sorted(['$SG1','$SG2'])")" "True"
check "group details for the calendar (course, level, instructor, students)" "$(echo "$CAL" | jq_ "[(g['course'] is not None, g['level'] is not None, g['teacher'] is not None, g['studentCount']) for g in d['data']['groups'] if g['id']=='$SG1'][0]")" "(True, True, True, 1)"
check "more than 62 days at once refused" "$(api GET "/api/groups/schedule?from=$(D 0)&to=$(D 90)" | jq_ "d['success']")" "False"
check "a month (6 weeks grid) is accepted" "$(api GET "/api/groups/schedule?from=$(D -20)&to=$(D 21)" | jq_ "d['success']")" "True"
check "not signed in -> refused (401)" "$(curl -s -b "$(mktemp)" $B/api/groups/schedule?from=$(D 0)\&to=$(D 0) -o /dev/null -w '%{http_code}')" "401"
SG3=$(mkgroup "E2E Sched Three" "$NLEVEL"); M "UPDATE ClassSection SET scheduleSlots='$EVERYDAY' WHERE id='$SG3'"
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.0.99
TCAL=$(curl -s -b "$TJ" "$B/api/groups/schedule?from=$(D 0)&to=$(D 0)")
check "teacher sees only his own groups in his calendar" "$(echo "$TCAL" | jq_ "sorted(set(s['groupId'] for s in d['data']['sessions']))==sorted(['$SG1','$SG2'])")" "True"
rm -f "$TJ"
echo "== 23. batches and houses switched off"
NOB=$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E No Batch\",\"sectionName\":\"N\",\"levelId\":\"$NLEVEL\"}")
check "group created without choosing a batch" "$(echo "$NOB" | jq_ "d['success']")" "True"
check "it got the branch's default batch in the background" "$(M "SELECT b.name FROM ClassSection c JOIN Batch b ON b.id=c.batchId WHERE c.className='E2E No Batch'")" "General"
check "same group name and section in the same branch/shift refused" "$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E No Batch\",\"sectionName\":\"N\"}" | jq_ "d['error']['code']")" "CONFLICT"
check "empty batch from an old screen is accepted too" "$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"batchId\":\"\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E No Batch 2\",\"sectionName\":\"N\"}" | jq_ "d['success']")" "True"
NOBS=$(api POST /api/students "$(stu NoBatch 01066660041 '' '' | python -c "import sys,json;d=json.load(sys.stdin);d.pop('batchId',None);print(json.dumps(d))")")
check "student created without a batch" "$(echo "$NOBS" | jq_ "d['success']")" "True"
check "student got the default batch, no house" "$(M "SELECT CONCAT(b.name,'/',IFNULL(s.houseId,'none')) FROM Student s JOIN Batch b ON b.id=s.batchId WHERE s.firstName='NoBatch'")" "General/none"
BP=$(curl -s -D - -b "$JAR" $B/dashboard/batches)
check "old Batches page sends you to Groups" "$(echo "$BP" | grep -qiE '^location: /dashboard/groups|url=/dashboard/groups|NEXT_REDIRECT;[a-z]*;/dashboard/groups' && echo yes)" "yes"
check "no Batches link in the menu any more" "$(grep -c "href: '/dashboard/batches'" app/dashboard/layout-client.tsx)" "0"
echo "== 24. session shift switched off (set from the group's time)"
NOS=$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"className\":\"E2E No Shift\",\"sectionName\":\"S\",\"levelId\":\"$NLEVEL\"}")
check "group created without choosing a shift" "$(echo "$NOS" | jq_ "d['success']")" "True"
NOSID=$(M "SELECT id FROM ClassSection WHERE className='E2E No Shift'")
check "no schedule yet: Morning" "$(M "SELECT s.code FROM ClassSection c JOIN Shift s ON s.id=c.shiftId WHERE c.id='$NOSID'")" "MORNING"
api PATCH /api/groups/$NOSID '{"scheduleSlots":[{"dayOfWeek":1,"time":"19:00"},{"dayOfWeek":3,"time":"19:00"}]}' >/dev/null
check "schedule at 19:00 -> shift follows: Night" "$(M "SELECT s.code FROM ClassSection c JOIN Shift s ON s.id=c.shiftId WHERE c.id='$NOSID'")" "NIGHT"
api PATCH /api/groups/$NOSID '{"scheduleSlots":[{"dayOfWeek":1,"time":"16:30"}]}' >/dev/null
check "schedule at 16:30 -> Evening" "$(M "SELECT s.code FROM ClassSection c JOIN Shift s ON s.id=c.shiftId WHERE c.id='$NOSID'")" "EVENING"
check "same name in the branch refused even if the time differs" "$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"className\":\"E2E No Shift\",\"sectionName\":\"S\"}" | jq_ "d['error']['code']")" "CONFLICT"
echo "== 25. phase A: branch profile, contact log, group capacity, holidays, renewals"
# A) branch profile
api PATCH /api/campuses/$CAMPUS '{"whatsapp":"01011112222","workingHours":"Sat-Thu 10:00-21:00","roomsCount":5,"maxStudents":100}' >/dev/null
BP=$(api GET /api/campuses/$CAMPUS/profile)
check "branch profile: WhatsApp, hours, rooms, capacity saved" "$(echo "$BP" | jq_ "'%s|%s|%s|%s' % (d['data']['campus']['whatsapp'], d['data']['campus']['workingHours'], d['data']['campus']['roomsCount'], d['data']['campus']['maxStudents'])")" "01011112222|Sat-Thu 10:00-21:00|5|100"
check "branch profile: live numbers (groups, students, fullness)" "$(echo "$BP" | jq_ "d['data']['stats']['activeGroups'] > 0 and d['data']['stats']['activeStudents'] > 0 and d['data']['stats']['fullness'] is not None")" "True"
check "branch profile: bad map link refused" "$(api PATCH /api/campuses/$CAMPUS '{"mapUrl":"not a link"}' | jq_ "d['success']")" "False"

# B) contact log + follow-ups + last contact
CL=$(mkstu Contact 01066660051 Samy 01066660052)
NOWISO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
check "staff logs a call with a follow-up today" "$(api POST /api/contact-logs "{\"studentId\":\"$CL\",\"channel\":\"CALL\",\"reason\":\"PAYMENT\",\"summary\":\"Asked about the invoice\",\"followUpAt\":\"$NOWISO\"}" | jq_ "d['success']")" "True"
CLID=$(M "SELECT id FROM ContactLog WHERE studentId='$CL' AND auto=0 LIMIT 1")
check "student page shows the contact" "$(api GET /api/students/$CL/contacts | jq_ "len(d['data']['logs'])")" "1"
check "it is in today's follow-ups" "$(api GET /api/contact-logs/follow-ups | jq_ "any(r['id']=='$CLID' for r in d['data']['today'])")" "True"
check "students list shows the last contact" "$(api GET "/api/students?search=Contact&limit=5" | jq_ "any(s['id']=='$CL' and s['lastContactAt'] for s in d['data'])")" "True"
api PATCH /api/contact-logs/$CLID '{"followUpDone":true}' >/dev/null
check "follow-up marked done leaves the list" "$(api GET /api/contact-logs/follow-ups | jq_ "any(r['id']=='$CLID' for r in d['data']['today'])")" "False"
check "not signed in: cannot write the contact log" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"studentId\":\"$CL\",\"channel\":\"CALL\",\"reason\":\"OTHER\",\"summary\":\"x x\"}" $B/api/contact-logs)" "401"

# C) group capacity + per-group waiting list
CAP=$(mkgroup "E2E Cap" "$NLEVEL"); CAP2=$(mkgroup "E2E Cap Two" "$NLEVEL")
api PATCH /api/groups/$CAP '{"maxStudents":1}' >/dev/null
CA=$(mkstu CapA 01066660061 '' ''); CB=$(mkstu CapB 01066660062 '' ''); CC=$(mkstu CapC 01066660063 '' ''); CD=$(mkstu CapD 01066660064 '' '')
check "first student fits (1/1)" "$(api POST /api/groups/$CAP/students "{\"studentId\":\"$CA\"}" | jq_ "d['success']")" "True"
check "group full -> refused with GROUP_FULL" "$(api POST /api/groups/$CAP/students "{\"studentId\":\"$CB\"}" | jq_ "d['error']['code']")" "GROUP_FULL"
check "put on this group's waiting list (#1)" "$(api POST /api/groups/$CAP/students "{\"studentId\":\"$CB\",\"waitlist\":true}" | jq_ "'%s/%s' % (d['data']['waitlisted'], d['data']['position'])")" "True/1"
GD=$(api GET /api/groups/$CAP)
check "group shows 1/1 full, 1 waiting" "$(echo "$GD" | jq_ "'%s/%s/%s/%s' % (d['data']['seats']['count'], d['data']['seats']['max'], d['data']['seats']['full'], len(d['data']['waiting']))")" "1/1/True/1"
check "other groups of the same level with room are offered" "$(api GET "/api/groups/available?levelId=$NLEVEL&excludeId=$CAP" | jq_ "any(g['id']=='$CAP2' for g in d['data'])")" "True"
api POST /api/groups/$CAP2/students "{\"studentId\":\"$CB\"}" >/dev/null
check "placing the waiting student in the other group closes the wait" "$(M "SELECT status FROM WaitingListEntry WHERE studentId='$CB' AND classSectionId='$CAP'")" "PLACED"
check "manager can add anyway (over the limit)" "$(api POST /api/groups/$CAP/students "{\"studentId\":\"$CC\",\"override\":true}" | jq_ "d['success']")" "True"
api POST /api/groups/$CAP/students "{\"studentId\":\"$CD\",\"waitlist\":true}" >/dev/null
for s in $CA $CC; do E=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$s' AND classSectionId='$CAP'"); api DELETE /api/student-enrollments/$E >/dev/null; done
check "a seat frees up -> staff notified (someone is waiting)" "$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='GROUP_SEAT_FREE' AND relatedId='$CAP'")" "1"
check "a limit of 0 is refused (empty = no limit)" "$(api PATCH /api/groups/$CAP '{"maxStudents":0}' | jq_ "d['success']")" "False"

# D) holidays + extra sessions (calendar keeps the numbering)
PH=$(mkgroup "E2E Holiday" "$NLEVEL")
M "UPDATE ClassSection SET scheduleSlots='$EVERYDAY' WHERE id='$PH'"
PHS=$(mkstu Holiday 01066660071 '' ''); api POST /api/groups/$PH/students "{\"studentId\":\"$PHS\"}" >/dev/null
PHE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$PHS' AND classSectionId='$PH'")
sess $PH "$(D -1)" "$(rec $PHE PRESENT)" >/dev/null
check "secretary cannot add a holiday" "$(secapi POST /api/holidays "{\"date\":\"$(D 1)\",\"name\":\"Test\"}" | jq_ "d['success']")" "False"
check "company-wide holiday added" "$(api POST /api/holidays "{\"date\":\"$(D 1)\",\"name\":\"E2E holiday\"}" | jq_ "d['data']['added']")" "1"
CAL=$(api GET "/api/groups/schedule?from=$(D -1)&to=$(D 5)")
check "holiday: session moved, numbering kept (held 1, today 2, holiday, 3, 4 last)" "$(row $PH)" "$(D -1 | cut -c6-):HELD:1 $(D 0 | cut -c6-):SCHEDULED:2 $(D 1 | cut -c6-):HOLIDAY:- $(D 2 | cut -c6-):SCHEDULED:3 $(D 3 | cut -c6-):SCHEDULED:4"
check "extra session added on the holiday evening" "$(api POST /api/groups/$PH/extra-sessions "{\"date\":\"$(D 1)\",\"time\":\"20:00\",\"reason\":\"make up\"}" | jq_ "d['success']")" "True"
CAL=$(api GET "/api/groups/schedule?from=$(D -1)&to=$(D 5)")
check "extra session counts: the month ends a day earlier" "$(echo "$CAL" | jq_ "[s['date'] for s in d['data']['sessions'] if s['groupId']=='$PH' and s['isLastOfCycle']]==['$(D 2)']")" "True"
HID=$(M "SELECT id FROM Holiday WHERE name='E2E holiday' LIMIT 1")
api DELETE /api/holidays/$HID >/dev/null
check "holiday removed -> the day is a normal session again" "$(api GET "/api/groups/schedule?from=$(D 1)&to=$(D 1)" | jq_ "any(s['status']=='HOLIDAY' for s in d['data']['sessions'] if s['groupId']=='$PH')")" "False"

# E) renewals: reminder, parent answers in the portal, early discount, churn reasons
api PUT /api/renewals/settings '{"sessionsBefore":2}' >/dev/null
T_EARLY=$(mktype '{"name":"Early renewal 5%","kind":"OTHER","valueType":"PERCENT","value":5,"duration":"ONE_TIME","approvalMode":"STAFF","stackable":true}')
api PUT /api/discounts/rules "{\"allowStacking\":true,\"maxTotalPercent\":null,\"siblingAppliesTo\":\"ALL\",\"earlyRenewalTypeId\":\"$T_EARLY\"}" >/dev/null
check "early renewal discount type set in Discounts > rules" "$(api GET /api/discounts/rules | jq_ "d['data']['earlyRenewalTypeId']")" "$T_EARLY"
RN=$(mkgroup "E2E Renew" "$NLEVEL")
R1=$(mkstu RenewOne 01066660081 Hoda 01066660082); R2=$(mkstu RenewTwo 01066660083 Omar 01066660084)
for s in $R1 $R2; do api POST /api/groups/$RN/students "{\"studentId\":\"$s\"}" >/dev/null; done
E1=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$R1' AND classSectionId='$RN'"); E2=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$R2' AND classSectionId='$RN'")
sess $RN "$(D -3)" "$(rec $E1 PRESENT),$(rec $E2 PRESENT)" >/dev/null
check "not asked yet (3 sessions left)" "$(M "SELECT COUNT(*) FROM RenewalRequest WHERE classSectionId='$RN'")" "0"
sess $RN "$(D -2)" "$(rec $E1 PRESENT),$(rec $E2 PRESENT)" >/dev/null
check "2 sessions before the end: every student asked" "$(M "SELECT COUNT(*) FROM RenewalRequest WHERE classSectionId='$RN' AND status='PENDING'")" "2"
G1USER=$(M "SELECT userId FROM Guardian WHERE phoneNumber='01066660082'")
check "parent notified in the portal" "$(M "SELECT COUNT(*) FROM Notification WHERE userId='$G1USER' AND type='RENEWAL_REQUEST'")" "1"
check "reminder written to the contact log (system)" "$(M "SELECT COUNT(*) FROM ContactLog WHERE studentId='$R1' AND channel='SYSTEM' AND reason='RENEWAL'")" "1"
api POST /api/users/reset-credentials "{\"userId\":\"$G1USER\",\"newPassword\":\"Renew2026A\"}" >/dev/null
M "UPDATE User SET mustChangePassword=0 WHERE id='$G1USER'"
RJ=$(mktemp); login_as 01066660082 Renew2026A "$RJ" >/dev/null
RQ1=$(M "SELECT id FROM RenewalRequest WHERE studentId='$R1'"); RQ2=$(M "SELECT id FROM RenewalRequest WHERE studentId='$R2'")
check "parent sees the question in the portal" "$(curl -s -b "$RJ" $B/api/guardian-portal/renewals | jq_ "[r['status'] for r in d['data']]")" "['PENDING']"
check "parent cannot answer for another family's child" "$(curl -s -o /dev/null -w '%{http_code}' -b "$RJ" -X POST -H 'Content-Type: application/json' -d '{"answer":"YES"}' $B/api/guardian-portal/renewals/$RQ2)" "403"
check "parent answers YES early -> early discount given" "$(curl -s -b "$RJ" -X POST -H 'Content-Type: application/json' -d '{"answer":"YES"}' $B/api/guardian-portal/renewals/$RQ1 | jq_ "d['data']['earlyDiscount']")" "True"
check "the discount is waiting for next month's invoice" "$(M "SELECT CONCAT(status,'/',timesUsed) FROM DiscountAssignment WHERE studentId='$R1' AND discountTypeId='$T_EARLY'")" "ACTIVE/0"
check "not continuing needs a reason" "$(api PATCH /api/renewals/$RQ2 '{"answer":"NO"}' | jq_ "d['success']")" "False"
check "staff record 'not continuing (price)' from a phone call" "$(api PATCH /api/renewals/$RQ2 '{"answer":"NO","reason":"PRICE","note":"too expensive"}' | jq_ "d['success']")" "True"
check "churn report counts the reason" "$(api GET /api/renewals | jq_ "d['data']['churn']['reasons'].get('PRICE', 0) >= 1")" "True"
check "group details carry the answers for Advance cycle" "$(api GET /api/groups/$RN | jq_ "sorted(r['status'] for r in d['data']['renewals'])")" "['NO', 'YES']"
curl -s -b "$RJ" -X POST -H 'Content-Type: application/json' -d '{"answer":"NO","reason":"TIME"}' $B/api/guardian-portal/renewals/$RQ1 >/dev/null
check "parent changes to NO -> unused early discount taken back" "$(M "SELECT status FROM DiscountAssignment WHERE studentId='$R1' AND discountTypeId='$T_EARLY'")" "ENDED"
rm -f "$RJ"
echo "== 26. phase B: wallet-first payments"
M "UPDATE DiscountType SET isActive=0 WHERE kind='SIBLING'" # keep the amounts simple (850 each)
bal() { api GET /api/students/$1/wallet | jq_ "d['data']['balance']"; }
WB=$(mkgroup "E2E Wallet" "$NLEVEL"); WB2=$(mkgroup "E2E Wallet Inst" "$NLEVEL")
M "UPDATE ClassSection SET installmentsAllowed=0 WHERE id='$WB'; UPDATE ClassSection SET installmentsAllowed=1 WHERE id='$WB2'"
W1=$(mkstu WalletOne 01066660091 Rania 01066660099); W2=$(mkstu WalletTwo 01066660092 Rania 01066660099); W3=$(mkstu WalletThree 01066660093 '' '')
# 1) every payment passes through the wallet
api POST /api/groups/$WB/students "{\"studentId\":\"$W1\"}" >/dev/null
W1INV=$(invid $W1 $WB)
api POST /api/fees/$W1INV/payments '{"amount":850,"paymentMethod":"Cash"}' >/dev/null
check "staff payment still recorded as STAFF with its receipt" "$(M "SELECT CONCAT(source,'/',receiptNumber LIKE 'TN-RCPT-%') FROM FeePayment WHERE invoiceId='$W1INV'")" "STAFF/1"
check "…and passed through the wallet: top-up TN-TOPUP in, payment out" "$(M "SELECT CONCAT(t.source,'/',t.topUpNumber LIKE 'TN-TOPUP-____-_____') FROM WalletTopUp t WHERE t.invoiceId='$W1INV'")/$(M "SELECT GROUP_CONCAT(CAST(amount AS DOUBLE) ORDER BY amount DESC) FROM WalletTransaction WHERE studentId='$W1'")" "PAYMENT/1/850,-850"
check "wallet back to 0 after a direct payment" "$(bal $W1)" "0"
# 2) staff top-up, no installments: waits until enough, then pays in full
check "staff top-up at the branch (500)" "$(api POST /api/wallet/topups "{\"studentId\":\"$W3\",\"amount\":500,\"method\":\"Cash\"}" | jq_ "d['data']['topUpNumber'][:9]")" "TN-TOPUP-"
api POST /api/groups/$WB/students "{\"studentId\":\"$W3\"}" >/dev/null
check "group without installments: 500 is not enough, invoice waits" "$(inv $W3 $WB)/$(bal $W3)" "850/0/850/ISSUED/500"
api POST /api/wallet/topups "{\"studentId\":\"$W3\",\"amount\":400,\"method\":\"InstaPay\"}" >/dev/null
check "after the next top-up the invoice is paid automatically (850), 50 left" "$(inv $W3 $WB)/$(bal $W3)" "850/0/850/PAID/50"
check "automatic payment has source WALLET" "$(M "SELECT source FROM FeePayment WHERE invoiceId='$(invid $W3 $WB)'")" "WALLET"
# 3) installments allowed: partial payment; 4) oldest first
api POST /api/wallet/topups "{\"studentId\":\"$W2\",\"amount\":300,\"method\":\"Cash\"}" >/dev/null
api POST /api/groups/$WB2/students "{\"studentId\":\"$W2\"}" >/dev/null
check "installments allowed: the new invoice is paid partly from the wallet (300)" "$(M "SELECT CONCAT(CAST(paidAmount AS DOUBLE),'/',status) FROM FeeInvoice WHERE id='$(invid $W2 $WB2)'")" "300/PARTIALLY_PAID"
api POST /api/groups/$WB/students "{\"studentId\":\"$W2\"}" >/dev/null
api POST /api/wallet/topups "{\"studentId\":\"$W2\",\"amount\":2000,\"method\":\"Cash\"}" >/dev/null
check "a big top-up pays every open invoice, oldest first (550 + 850), 600 left" "$(M "SELECT status FROM FeeInvoice WHERE id='$(invid $W2 $WB2)'")/$(M "SELECT status FROM FeeInvoice WHERE id='$(invid $W2 $WB)'")/$(bal $W2)" "PAID/PAID/600"
check "parent notified of each automatic payment, with the receipt id" "$(M "SELECT COUNT(*) FROM Notification n JOIN Guardian g ON g.userId=n.userId JOIN FeePayment p ON p.id=n.relatedId WHERE g.phoneNumber='01066660099' AND n.type='WALLET_PAYMENT' AND p.source='WALLET'")" "3"
# 5) minimum top-up
api PUT /api/wallet/rules '{"rules":[{"kind":"MIN_TOPUP","scopeType":"ALL","minAmount":200}]}' >/dev/null
check "below the minimum (100 < 200) refused" "$(api POST /api/wallet/topups "{\"studentId\":\"$W1\",\"amount\":100,\"method\":\"Cash\"}" | jq_ "d['success']")" "False"
check "at the minimum accepted" "$(api POST /api/wallet/topups "{\"studentId\":\"$W1\",\"amount\":200,\"method\":\"Cash\"}" | jq_ "d['success']")" "True"
api PUT /api/wallet/rules "{\"rules\":[{\"kind\":\"MIN_TOPUP\",\"scopeType\":\"ALL\",\"minAmount\":200},{\"kind\":\"MIN_TOPUP\",\"scopeType\":\"GROUP\",\"scopeId\":\"$WB2\",\"minAmount\":500}]}" >/dev/null
check "a student in several groups gets the largest minimum (500)" "$(api GET /api/students/$W2/wallet | jq_ "d['data']['minimumTopUp']")" "500"
# 6) sibling transfer
check "move 200 to a sibling (same parent)" "$(api POST /api/students/$W2/wallet/transfer "{\"toStudentId\":\"$W1\",\"amount\":200}" | jq_ "d['success']")/$(bal $W2)/$(bal $W1)" "True/400/400"
check "not to a student of another family" "$(api POST /api/students/$W1/wallet/transfer "{\"toStudentId\":\"$W3\",\"amount\":10}" | jq_ "d['success']")" "False"
# 7) withdrawals: rules, approval, fee by payout method
api PUT /api/wallet/rules '{"rules":[{"kind":"WITHDRAW","scopeType":"ALL","allowed":false}]}' >/dev/null
check "withdrawals switched off in the rules -> refused" "$(api POST /api/wallet/withdrawals "{\"studentId\":\"$W2\",\"amount\":100,\"payoutMethod\":\"Cash\"}" | jq_ "d['success']")" "False"
api PUT /api/wallet/rules '{"rules":[{"kind":"WITHDRAW","scopeType":"ALL","allowed":true}]}' >/dev/null
api PUT /api/wallet/settings '{"paymobFeePercent":2.5,"paymobFeeFixed":0,"withdrawFees":{"Cash":{"type":"FIXED","value":10}},"lowBalanceDays":3,"promos":[{"minAmount":1000,"bonus":100,"active":true}]}' >/dev/null
WDR=$(api POST /api/wallet/withdrawals "{\"studentId\":\"$W2\",\"amount\":100,\"payoutMethod\":\"Cash\",\"reason\":\"e2e\"}")
WDID=$(echo "$WDR" | jq_ "d['data']['withdrawalId']")
check "withdrawal requested with the Cash fee (10)" "$(echo "$WDR" | jq_ "d['data']['fee']")" "10"
check "more than the balance refused" "$(api POST /api/wallet/withdrawals "{\"studentId\":\"$W2\",\"amount\":5000,\"payoutMethod\":\"Cash\"}" | jq_ "d['success']")" "False"
check "secretary cannot approve a withdrawal" "$(secapi PATCH /api/wallet/withdrawals/$WDID '{"action":"approve"}' | jq_ "d['success']")" "False"
check "manager approves: TN-WDRW number, wallet -100" "$(api PATCH /api/wallet/withdrawals/$WDID '{"action":"approve"}' | jq_ "d['data']['withdrawalNumber'][:8]")/$(bal $W2)" "TN-WDRW-/300"
# 8) uploaded receipt approved; online top-up (webhook, fee on top); promo
M "INSERT INTO WalletTopUp (id, studentId, amount, fee, method, source, status, proofUrl, createdAt, updatedAt) VALUES ('wt-e2e-1','$W3',300,0,'Bank Transfer','PROOF','PENDING','https://res.cloudinary.com/demo/x.png',NOW(3),NOW(3))"
check "receipt waiting in 'Receipts to check'" "$(api GET '/api/wallet/topups?status=PENDING' | jq_ "any(t['id']=='wt-e2e-1' for t in d['data']['topUps'])")" "True"
check "approved -> numbered and added to the wallet" "$(api PATCH /api/wallet/topups/wt-e2e-1 '{"action":"approve"}' | jq_ "d['data']['topUpNumber'][:9]")/$(bal $W3)" "TN-TOPUP-/350"
check "approving twice refused" "$(api PATCH /api/wallet/topups/wt-e2e-1 '{"action":"approve"}' | jq_ "d['success']")" "False"
M "INSERT INTO OnlinePayment (id, kind, invoiceId, studentId, amount, fee, provider, status, createdById, createdAt, updatedAt) VALUES ('op-e2e-top','TOPUP',NULL,'$W3',500,12.5,'PAYMOB','PENDING','$SA_ID',NOW(3),NOW(3))"
check "online top-up callback must include the fee (500 alone -> review)" "$(hook op-e2e-top 6001 50000 true)/$(M "SELECT status FROM OnlinePayment WHERE id='op-e2e-top'")" "200/REVIEW"
M "INSERT INTO OnlinePayment (id, kind, invoiceId, studentId, amount, fee, provider, status, createdById, createdAt, updatedAt) VALUES ('op-e2e-top2','TOPUP',NULL,'$W3',500,12.5,'PAYMOB','PENDING','$SA_ID',NOW(3),NOW(3))"
check "online top-up with fee (512.50 paid) -> wallet +500" "$(hook op-e2e-top2 6002 51250 true)/$(M "SELECT CONCAT(t.source,'/',CAST(t.fee AS DOUBLE)) FROM WalletTopUp t JOIN OnlinePayment o ON o.topUpId=t.id WHERE o.id='op-e2e-top2'")/$(bal $W3)" "200/ONLINE/12.5/850"
api POST /api/wallet/topups "{\"studentId\":\"$W3\",\"amount\":1000,\"method\":\"Cash\"}" >/dev/null
check "top-up offer: 1000+ gives a 100 EGP discount on the next invoice" "$(M "SELECT CAST(a.value AS DOUBLE) FROM DiscountAssignment a JOIN DiscountType t ON t.id=a.discountTypeId WHERE a.studentId='$W3' AND t.name='Top-up bonus' AND a.status='ACTIVE'")" "100"
# 9) parent portal
GW=$(M "SELECT userId FROM Guardian WHERE phoneNumber='01066660099'")
api POST /api/users/reset-credentials "{\"userId\":\"$GW\",\"newPassword\":\"Wallet2026A\"}" >/dev/null
M "UPDATE User SET mustChangePassword=0 WHERE id='$GW'"
WJ=$(mktemp); login_as 01066660099 Wallet2026A "$WJ" >/dev/null
pget() { curl -s -b "$WJ" "$B$1"; }
ppost() { curl -s -b "$WJ" -X "$1" -H 'Content-Type: application/json' -d "$3" "$B$2"; }
check "parent sees both children's wallets" "$(pget /api/guardian-portal/wallet | jq_ "sorted(w['balance'] for w in d['data']['wallets'])")" "[300, 400]"
check "parent moves 50 between the children" "$(ppost POST /api/guardian-portal/wallet/transfer "{\"fromId\":\"$W1\",\"toId\":\"$W2\",\"amount\":50}" | jq_ "d['success']")/$(bal $W1)/$(bal $W2)" "True/350/350"
check "parent cannot move money from another family's child" "$(ppost POST /api/guardian-portal/wallet/transfer "{\"fromId\":\"$W3\",\"toId\":\"$W1\",\"amount\":10}" | jq_ "d['success']")" "False"
check "parent asks for a withdrawal (waits for approval)" "$(ppost POST /api/guardian-portal/wallet/withdrawals "{\"studentId\":\"$W1\",\"amount\":50,\"payoutMethod\":\"Cash\"}" | jq_ "d['success']")" "True"
check "online top-up refused while Paymob is not connected" "$(curl -s -o /dev/null -w '%{http_code}' -b "$WJ" -X POST -H 'Content-Type: application/json' -d "{\"studentId\":\"$W1\",\"amount\":500,\"mode\":\"ONLINE\"}" $B/api/guardian-portal/wallet/topups)" "503"
ppost PATCH /api/guardian-portal/wallet/visibility "{\"studentId\":\"$W2\",\"visible\":false}" >/dev/null
check "parent hides the wallet from one child" "$(M "SELECT walletVisibleToStudent FROM Student WHERE id='$W2'")" "0"
check "account statement: closing = balance" "$(api GET /api/students/$W2/wallet/statement | jq_ "d['data']['closing']")" "$(bal $W2)"
rm -f "$WJ"
# 10) prepaid total + low-balance alert (cron)
check "prepaid money shown (sum of wallets)" "$(api GET /api/wallet/summary | jq_ "d['data']['prepaidTotal'] >= 1500")" "True"
M "UPDATE ClassSection SET scheduleSlots='$EVERYDAY' WHERE id='$WB'"
W4=$(mkstu WalletLow 01066660094 Sara 01066660095); api POST /api/groups/$WB/students "{\"studentId\":\"$W4\"}" >/dev/null
W4E=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$W4' AND classSectionId='$WB'")
sess $WB "$(D -1)" "$(rec $W4E PRESENT)" >/dev/null
check "cron refused without the secret" "$(curl -s -o /dev/null -w '%{http_code}' $B/api/cron/wallet-alerts)" "401"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/wallet-alerts >/dev/null
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/wallet-alerts >/dev/null
check "low-balance alert sent once to the parent (month ends soon, wallet < price)" "$(M "SELECT COUNT(*) FROM Notification n JOIN Guardian g ON g.userId=n.userId WHERE g.phoneNumber='01066660095' AND n.type='LOW_BALANCE'")" "1"
check "only one place creates FeePayment (wallet uses recordPayment)" "$(grep -rn 'feePayment.create(' app lib --include=*.ts | wc -l | tr -d ' ')" "1"
echo "== 27. phase C: notifications, excuses, attendance, ratings, reports, birthdays, dashboard"
NOTIF() { M "SELECT COUNT(*) FROM Notification n JOIN Guardian g ON g.userId=n.userId WHERE g.phoneNumber='01066660099' AND n.type='$1'"; }
check "notification settings list every event (on by default)" "$(api GET /api/notifications/settings | jq_ "all(e['on'] for e in d['data']['events']) and len(d['data']['events'])>=20")" "True"
check "secretary cannot change notification settings" "$(secapi PUT /api/notifications/settings '{"switches":{"ATTENDANCE_LATE":false}}' | jq_ "d['success']")" "False"
check "a new invoice notified the parent (INVOICE_NEW)" "$(python -c "print(int('$(NOTIF INVOICE_NEW)')>=1)")" "True"
W1E=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$W1' AND classSectionId='$WB'")
W2E=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$W2' AND classSectionId='$WB'")
# 1) attendance notifications: lateness switched off, then on; absent twice in a row
api PUT /api/notifications/settings '{"switches":{"ATTENDANCE_LATE":false}}' >/dev/null
sess $WB "$(D -3)" "$(rec $W1E LATE),$(rec $W2E ABSENT)" >/dev/null
check "absent → parent notified; late switched off → nothing" "$(NOTIF ATTENDANCE_ABSENT)/$(NOTIF ATTENDANCE_LATE)" "1/0"
sess $WB "$(D -3)" "$(rec $W1E LATE),$(rec $W2E ABSENT)" >/dev/null
check "saving the same sheet again does not notify twice" "$(NOTIF ATTENDANCE_ABSENT)" "1"
api PUT /api/notifications/settings '{"switches":{"ATTENDANCE_LATE":true}}' >/dev/null
sess $WB "$(D -2)" "$(rec $W1E LATE),$(rec $W2E ABSENT)" >/dev/null
check "late switched on → parent notified" "$(NOTIF ATTENDANCE_LATE)" "1"
check "absent twice in a row → staff alert + follow-up in the contact log" "$(M "SELECT COUNT(*) FROM Notification WHERE type='CONSECUTIVE_ABSENCE' AND relatedId='$W2'" | python -c "import sys;print(int(sys.stdin.read())>=1)")/$(M "SELECT COUNT(*) FROM ContactLog WHERE studentId='$W2' AND reason='ABSENCE' AND followUpAt IS NOT NULL")" "True/1"
# 2) excuses
WJ=$(mktemp); login_as 01066660099 Wallet2026A "$WJ" >/dev/null
pget() { curl -s -b "$WJ" "$B$1"; }
ppost() { curl -s -b "$WJ" -X "$1" -H 'Content-Type: application/json' -d "$3" "$B$2"; }
check "parent sees today's session among the ones to excuse" "$(pget "/api/guardian-portal/excuses?studentId=$W1" | jq_ "any(s['classSectionId']=='$WB' and s['date']=='$(D 0)' for s in d['data']['sessions'])")" "True"
check "no rule = accepted automatically" "$(ppost POST /api/guardian-portal/excuses "{\"studentId\":\"$W1\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$(D 0)\",\"reason\":\"He has a cold\"}" | jq_ "d['data']['status']")" "APPROVED"
check "the attendance sheet shows the excuse" "$(api GET "/api/enrollment-attendance/roster?classSectionId=$WB&date=$(D 0)" | jq_ "[e['excuse']['status'] for e in d['data']['enrollments'] if e['studentEnrollmentId']=='$W1E'][0]")" "APPROVED"
sess $WB "$(D 0)" "$(rec $W1E ABSENT),$(rec $W2E PRESENT)" >/dev/null
check "absent with an approved excuse is saved as EXCUSED" "$(M "SELECT status FROM EnrollmentAttendanceRecord WHERE studentEnrollmentId='$W1E' AND attendanceDate='$(D 0)'")" "EXCUSED"
check "too late: 5 days after the session refused" "$(ppost POST /api/guardian-portal/excuses "{\"studentId\":\"$W1\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$(D -5)\",\"reason\":\"late\"}" | jq_ "d['success']")" "False"
check "parent cannot excuse another family's child" "$(ppost POST /api/guardian-portal/excuses "{\"studentId\":\"$W3\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$(D 1)\",\"reason\":\"x\"}" | jq_ "d['success']")" "False"
check "secretary cannot change excuse settings" "$(secapi PUT /api/absence-excuses/rules '{"rules":[]}' | jq_ "d['success']")" "False"
check "settings: this group needs approval, 1 day after" "$(api PUT /api/absence-excuses/rules "{\"rules\":[{\"scopeType\":\"ALL\",\"autoApprove\":true,\"daysAfter\":2},{\"scopeType\":\"GROUP\",\"scopeId\":\"$WB\",\"autoApprove\":false,\"daysAfter\":1}]}" | jq_ "len(d['data']['rules'])")" "2"
EX2=$(ppost POST /api/guardian-portal/excuses "{\"studentId\":\"$W2\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$(D 1)\",\"reason\":\"Family trip\"}")
EX2ID=$(echo "$EX2" | jq_ "d['data']['id']")
check "now it waits for approval" "$(echo "$EX2" | jq_ "d['data']['status']")" "PENDING"
check "staff told an excuse is waiting" "$(M "SELECT COUNT(*) FROM Notification WHERE type='EXCUSE_PENDING' AND relatedId='$EX2ID'" | python -c "import sys;print(int(sys.stdin.read())>=1)")" "True"
check "the group's 1-day window applies (2 days after refused)" "$(ppost POST /api/guardian-portal/excuses "{\"studentId\":\"$W2\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$(D -2)\",\"reason\":\"x\"}" | jq_ "d['success']")" "False"
check "secretary approves; parent notified" "$(secapi PATCH /api/absence-excuses/$EX2ID '{"action":"approve"}' | jq_ "d['data']['status']")/$(NOTIF EXCUSE_DECIDED)" "APPROVED/1"
check "parent withdraws the excuse of a future session" "$(curl -s -b "$WJ" -X DELETE "$B/api/guardian-portal/excuses/$EX2ID" | jq_ "d['data']['status']")" "CANCELLED"
# 3) attendance in the portal (no instructor name)
TL=$(pget /api/students/$W1/attendance-timeline)
check "portal attendance: session numbers, statuses and the excuse reason" "$(echo "$TL" | jq_ "[(s['status'], s['excuseReason']) for g in d['data']['groups'] if g['classSectionId']=='$WB' for s in g['sessions']][-1]")" "('EXCUSED', 'He has a cold')"
check "no instructor name in the portal attendance" "$(echo "$TL" | jq_ "'teacher' in json.dumps(d).lower()" 2>/dev/null || echo "$TL" | python -c "import sys;print('teacher' in sys.stdin.read().lower())")" "False"
check "parent cannot read another family's attendance" "$(curl -s -o /dev/null -w '%{http_code}' -b "$WJ" $B/api/students/$W3/attendance-timeline)" "403"
# 4) ratings
M "UPDATE Student SET dateOfBirth='2021-03-03' WHERE id='$W1'"
check "young child: the parent rates the session for them" "$(pget /api/ratings/parent | jq_ "[c['young'] and len(c['sessions'])>0 for c in d['data']['children'] if c['studentId']=='$W1'][0]")" "True"
check "rating 🙁 → managers alerted + follow-up" "$(ppost POST /api/ratings/parent "{\"type\":\"session\",\"studentId\":\"$W1\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$(D -2)\",\"rating\":1,\"comment\":\"too noisy\"}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM Notification WHERE type='LOW_RATING' AND relatedId='$W1'" | python -c "import sys;print(int(sys.stdin.read())>=1)")/$(M "SELECT COUNT(*) FROM ContactLog WHERE studentId='$W1' AND reason='COMPLAINT'")" "True/True/1"
check "the same session cannot be rated twice" "$(ppost POST /api/ratings/parent "{\"type\":\"session\",\"studentId\":\"$W1\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$(D -2)\",\"rating\":4}" | jq_ "d['success']")" "False"
M "UPDATE ClassSection SET status='COMPLETED', completedAt=NOW(3) WHERE id='$WB2'"
check "month ended → the parent survey opens" "$(pget /api/ratings/parent | jq_ "any(s['classSectionId']=='$WB2' for c in d['data']['children'] for s in c['surveys'])")" "True"
check "survey with a low answer → saved + managers alerted" "$(ppost POST /api/ratings/parent "{\"type\":\"survey\",\"studentId\":\"$W2\",\"classSectionId\":\"$WB2\",\"sessionsRating\":5,\"teacherRating\":4,\"companyRating\":2,\"comment\":\"prices\"}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM ParentSurvey WHERE studentId='$W2'")" "True/1"
check "managers see ratings with names; secretary does not" "$(api GET /api/ratings/overview | jq_ "d['data']['latestSurveys'][0]['student'].startswith('WalletTwo')")/$(secapi GET /api/ratings/overview | jq_ "d['success']")" "True/False"
M "UPDATE ClassSection SET status='ACTIVE', completedAt=NULL WHERE id='$WB2'"
# 5) reports
M "UPDATE ClassSection SET status='COMPLETED', completedAt=NOW(3) WHERE id='$WB'"
check "finished month → monthly report listed" "$(pget /api/students/$W2/reports | jq_ "any(r['kind']=='MONTHLY' and r['classSectionId']=='$WB' for r in d['data'])")" "True"
check "monthly report: attendance session by session" "$(pget "/api/students/$W2/reports?kind=MONTHLY&group=$WB" | jq_ "(d['data']['stats']['sessions'], d['data']['stats']['absent'])")" "(3, 2)"
check "printable report page opens" "$(curl -s -o /dev/null -w '%{http_code}' -b "$WJ" "$B/reports/student/$W2?kind=MONTHLY&group=$WB")" "200"
M "UPDATE ClassSection SET status='ACTIVE', completedAt=NULL WHERE id='$WB'"
# 6) birthdays (students, parents, staff) + birthday discount
TODAYMD=$(date -u +%m-%d)
GW=$(M "SELECT userId FROM Guardian WHERE phoneNumber='01066660099'")
M "UPDATE Student SET dateOfBirth='2019-$TODAYMD' WHERE id='$W1'"
M "UPDATE User SET dateOfBirth='1985-$TODAYMD' WHERE id='$GW'"
check "secretary sets her own date of birth" "$(secapi PUT /api/users/date-of-birth "{\"dateOfBirth\":\"1990-$TODAYMD\"}" | jq_ "d['success']")" "True"
BT=$(mktype '{"name":"Birthday gift","kind":"OTHER","valueType":"FIXED","value":50,"duration":"ONE_TIME","approvalMode":"STAFF","stackable":true}')
api PUT /api/discounts/rules "{\"allowStacking\":true,\"maxTotalPercent\":50,\"siblingAppliesTo\":\"SECOND_AND_LATER\",\"birthdayTypeId\":\"$BT\"}" >/dev/null
check "birthdays today: student, parent and staff" "$(api GET '/api/birthdays?range=today' | jq_ "sorted(set(p['kind'] for p in d['data']['people'] if p['name'].startswith(('WalletOne','Rania')) or p['kind']=='STAFF'))")" "['GUARDIAN', 'STAFF', 'STUDENT']"
check "parent portal: big birthday banner for the child" "$(pget /api/birthdays/me | jq_ "[c['name'] for c in d['data']['children']]")" "['WalletOne']"
check "daily cron refused without the secret" "$(curl -s -o /dev/null -w '%{http_code}' $B/api/cron/daily)" "401"
DAILY=$(curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily)
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "daily job: birthday greeting to the student's family (once)" "$(NOTIF BIRTHDAY | python -c "import sys;print(int(sys.stdin.read()))")/$(M "SELECT COUNT(*) FROM BirthdayGreeting WHERE personType='STUDENT' AND personId='$W1'")" "2/1"
check "birthday discount given (once)" "$(M "SELECT COUNT(*) FROM DiscountAssignment WHERE studentId='$W1' AND discountTypeId='$BT'")" "1"
check "staff colleagues told about the staff birthday" "$(M "SELECT COUNT(*) FROM Notification WHERE type='BIRTHDAY_STAFF' AND title LIKE 'Colleague%'" | python -c "import sys;print(int(sys.stdin.read())>=1)")" "True"
check "birthday certificate data for the parent" "$(curl -s -o /dev/null -w '%{http_code}' -b "$WJ" $B/api/students/$W1/birthday-card)" "200"
# 7) dashboard numbers + morning summary
check "manager dashboard numbers" "$(api GET /api/dashboard/insights | jq_ "[m['key'] for m in d['data']['metrics']][:4]")" "['income', 'collection', 'students', 'renewal']"
check "secretary dashboard numbers" "$(secapi GET /api/dashboard/insights | jq_ "d['data']['metrics'][0]['key']")" "followups"
check "morning summary sent once a day to the managers" "$(echo "$DAILY" | jq_ "d['morningSummary']['sent']>=1")/$(M "SELECT COUNT(*) FROM Notification WHERE type='MORNING_SUMMARY' AND userId='$SA_ID'")" "True/1"
# 8) holiday → families told
HOL=$(api POST /api/holidays "{\"date\":\"$(D 3)\",\"name\":\"E2E day off\",\"campusId\":\"$CAMPUS\"}")
check "holiday on a session day → families told" "$(NOTIF HOLIDAY | python -c "import sys;print(int(sys.stdin.read())>=1)")" "True"
M "DELETE FROM Holiday WHERE name='E2E day off'"
rm -f "$WJ"
echo "== 28. phase D: referrals, complaints & suggestions"
WJ=$(mktemp); login_as 01066660099 Wallet2026A "$WJ" >/dev/null
pget() { curl -s -b "$WJ" "$B$1"; }
ppost() { curl -s -b "$WJ" -X "$1" -H 'Content-Type: application/json' -d "$3" "$B$2"; }
RNOTIF() { M "SELECT COUNT(*) FROM Notification n JOIN Guardian g ON g.userId=n.userId WHERE g.phoneNumber='01066660099' AND n.type='$1'"; }
# 1) referral settings + code
WT=$(mktype '{"name":"Referral welcome","kind":"PROMO","valueType":"PERCENT","value":10,"duration":"FIRST_CYCLE","approvalMode":"STAFF","stackable":true}')
check "secretary cannot change referral settings" "$(secapi PUT /api/referrals/settings "{\"rewardEnabled\":true,\"rewardAmount\":150,\"welcomeEnabled\":false,\"welcomeTypeId\":null,\"ambassadorAt\":3}" | jq_ "d['success']")" "False"
check "reward 150 EGP + welcome discount switched on" "$(api PUT /api/referrals/settings "{\"rewardEnabled\":true,\"rewardAmount\":150,\"welcomeEnabled\":true,\"welcomeTypeId\":\"$WT\",\"ambassadorAt\":3}" | jq_ "d['success']")" "True"
RCODE=$(pget /api/referrals/mine | jq_ "d['data']['code']")
check "parent gets a referral code in the portal" "$(echo "$RCODE" | cut -c1-12)" "TN-REF-RANIA"
check "the code stays the same" "$(pget /api/referrals/mine | jq_ "d['data']['code']")" "$RCODE"
# 2) new student registered with the code
W5=$(api POST /api/students "$(stu ReferredKid 01066660096 Mona 01066660097 | sed "s/}\$/,\"referralCode\":\"$(echo $RCODE | tr 'A-Z' 'a-z')\"}/")" | jq_ "d['data']['id']")
check "admission with the code (any case) links the referral" "$(M "SELECT status FROM Referral WHERE referredStudentId='$W5'")" "PENDING"
check "welcome discount given to the new student" "$(M "SELECT COUNT(*) FROM DiscountAssignment WHERE studentId='$W5' AND discountTypeId='$WT' AND status='ACTIVE'")" "1"
check "referrer told a friend registered" "$(RNOTIF REFERRAL_UPDATE)" "1"
check "a parent cannot refer their own child" "$(api POST /api/referrals "{\"studentId\":\"$W1\",\"codeOrPhone\":\"$RCODE\"}" | jq_ "d['success']")" "False"
check "a student is linked only once" "$(api POST /api/referrals "{\"studentId\":\"$W5\",\"codeOrPhone\":\"01066660095\"}" | jq_ "d['success']")" "False"
check "unknown code refused" "$(api POST /api/referrals "{\"studentId\":\"$W3\",\"codeOrPhone\":\"TN-REF-NOBODY1\"}" | jq_ "d['success']")" "False"
# 3) first paid invoice → reward in the referrer's child's wallet
api POST /api/groups/$WB/students "{\"studentId\":\"$W5\"}" >/dev/null
W5INV=$(invid $W5 $WB)
check "the new student's first invoice has the 10% welcome discount" "$(M "SELECT CAST(discount AS DOUBLE)>0 FROM FeeInvoice WHERE id='$W5INV'")" "1"
W5HALF=$(M "SELECT CAST(totalAmount AS DOUBLE)/2 FROM FeeInvoice WHERE id='$W5INV'")
M "UPDATE ClassSection SET installmentsAllowed=1 WHERE id='$WB'"
api POST /api/fees/$W5INV/payments "{\"amount\":$W5HALF,\"paymentMethod\":\"Cash\"}" >/dev/null
check "half paid → no reward yet" "$(M "SELECT status FROM Referral WHERE referredStudentId='$W5'")" "PENDING"
W5LEFT=$(M "SELECT CAST(totalAmount-paidAmount AS DOUBLE) FROM FeeInvoice WHERE id='$W5INV'")
api POST /api/fees/$W5INV/payments "{\"amount\":$W5LEFT,\"paymentMethod\":\"Cash\"}" >/dev/null
M "UPDATE ClassSection SET installmentsAllowed=0 WHERE id='$WB'"
check "first invoice PAID → referral rewarded" "$(M "SELECT CONCAT(status,'/',CAST(rewardAmount AS DOUBLE)) FROM Referral WHERE referredStudentId='$W5'")" "REWARDED/150"
check "150 EGP added to the referrer's child's wallet" "$(M "SELECT COUNT(*) FROM WalletTransaction WHERE type='REFERRAL' AND CAST(amount AS DOUBLE)=150 AND studentId IN ('$W1','$W2')")" "1"
check "referrer told about the reward" "$(RNOTIF REFERRAL_UPDATE)" "2"
check "portal shows the friend and the reward" "$(pget /api/referrals/mine | jq_ "(d['data']['rewardedCount'], d['data']['totalReward'], d['data']['ambassador'])")" "(1, 150, False)"
check "referrals report (managers)" "$(api GET /api/referrals | jq_ "d['data']['totals']['rewarded']>=1")" "True"
# 4) complaints: parent sends, secretary handles
check "low rating (section 27) opened a complaint automatically" "$(M "SELECT COUNT(*) FROM Complaint WHERE studentId='$W1' AND source='AUTO_RATING'")" "1"
C1=$(ppost POST /api/complaints "{\"kind\":\"COMPLAINT\",\"topic\":\"INSTRUCTOR\",\"body\":\"The instructor is late every session\",\"studentId\":\"$W1\"}")
C1ID=$(echo "$C1" | jq_ "d['data']['id']")
check "parent sends a complaint → numbered TN-CMP" "$(echo "$C1" | jq_ "d['data']['number'][:11]")/$(M "SELECT status FROM Complaint WHERE id='$C1ID'")" "TN-CMP-$(date +%Y)/NEW"
check "handlers (secretary) told" "$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.email='sec@e2e.local' AND n.type='COMPLAINT_NEW' AND n.relatedId='$C1ID'")" "1"
check "parent cannot write about another family's child" "$(ppost POST /api/complaints "{\"kind\":\"COMPLAINT\",\"topic\":\"OTHER\",\"body\":\"test test\",\"studentId\":\"$W3\"}" | jq_ "d['success']")" "False"
check "secretary sees it in the queue" "$(secapi GET /api/complaints | jq_ "any(c['id']=='$C1ID' for c in d['data']['complaints'])")" "True"
RUSER=$(M "SELECT userId FROM Guardian WHERE phoneNumber='01066660099'")
check "parent sees only their own messages" "$(pget /api/complaints | jq_ "(len(d['data']['complaints']), d['data']['portal'])")" "($(M "SELECT COUNT(*) FROM Complaint WHERE complainantId='$RUSER'"), True)"
# escalation after the deadline
M "UPDATE Complaint SET dueAt=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR) WHERE id='$C1ID'"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "no reply before the deadline → escalated to the managers" "$(M "SELECT escalatedAt IS NOT NULL FROM Complaint WHERE id='$C1ID'")/$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='COMPLAINT_ESCALATED' AND relatedId='$C1ID'")" "1/1"
secapi POST /api/complaints/$C1ID '{"body":"Checked with the manager, internal","internal":true}' >/dev/null
check "secretary replies → In progress, parent notified" "$(secapi POST /api/complaints/$C1ID '{"body":"We spoke to the instructor, sorry!"}' | jq_ "d['success']")/$(M "SELECT status FROM Complaint WHERE id='$C1ID'")/$(RNOTIF COMPLAINT_UPDATE)" "True/IN_PROGRESS/1"
check "parent never sees internal notes" "$(pget /api/complaints/$C1ID | jq_ "[r['internal'] for r in d['data']['replies']]")" "[False]"
check "parent cannot change the stage" "$(ppost PATCH /api/complaints/$C1ID '{"status":"CLOSED"}' | jq_ "d['success']")" "False"
secapi PATCH /api/complaints/$C1ID '{"status":"RESOLVED"}' >/dev/null
check "marked solved → parent asked; 'not yet' sends it back" "$(ppost POST /api/complaints/$C1ID/confirm '{"satisfied":false}' | jq_ "d['success']")/$(M "SELECT status FROM Complaint WHERE id='$C1ID'")" "True/IN_PROGRESS"
secapi PATCH /api/complaints/$C1ID '{"status":"RESOLVED"}' >/dev/null
check "'yes, solved' + 5 stars → closed" "$(ppost POST /api/complaints/$C1ID/confirm '{"satisfied":true,"rating":5}' | jq_ "d['success']")/$(M "SELECT CONCAT(status,'/',handlingRating) FROM Complaint WHERE id='$C1ID'")" "True/CLOSED/5"
check "no replies on a closed complaint" "$(secapi POST /api/complaints/$C1ID '{"body":"x"}' | jq_ "d['success']")" "False"
# phone complaint + auto-close
check "secretary records a phone suggestion in the parent's name" "$(secapi POST /api/complaints "{\"studentId\":\"$W2\",\"from\":\"PARENT\",\"kind\":\"SUGGESTION\",\"topic\":\"SCHEDULE\",\"body\":\"Please add a Friday group\"}" | jq_ "d['success']")/$(M "SELECT CONCAT(source,'/',complainantRole) FROM Complaint WHERE studentId='$W2' AND kind='SUGGESTION'")" "True/PHONE/PARENT"
C2ID=$(ppost POST /api/complaints "{\"kind\":\"PRAISE\",\"topic\":\"INSTRUCTOR\",\"body\":\"Great instructor, thank you\",\"studentId\":\"$W2\"}" | jq_ "d['data']['id']")
secapi PATCH /api/complaints/$C2ID '{"status":"RESOLVED"}' >/dev/null
M "UPDATE Complaint SET resolvedAt=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 5 DAY) WHERE id='$C2ID'"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "solved and no answer for 3 days → closed by itself" "$(M "SELECT status FROM Complaint WHERE id='$C2ID'")" "CLOSED"
check "monthly report (managers only)" "$(api GET /api/complaints/report | jq_ "d['data']['report']['total']>=4")/$(secapi GET /api/complaints/report | jq_ "d['success']")" "True/False"
rm -f "$WJ"
echo "== 29. foundations: platform switches, language, agreements, marketing flag"
check "platform settings readable by any staff (modules start OFF, agreements ON)" "$(secapi GET /api/platform/settings | jq_ "(d['data']['modules']['lms'], d['data']['modules']['agreements'], d['data']['language']['portal'])")" "(False, True, 'en')"
check "secretary cannot change platform settings" "$(secapi PUT /api/platform/settings '{"modules":{"lms":true}}' | jq_ "d['success']")" "False"
check "admin switches LMS on and portal language to Arabic" "$(api PUT /api/platform/settings '{"modules":{"lms":true},"language":{"staff":"en","portal":"ar"}}' | jq_ "(d['data']['modules']['lms'], d['data']['language']['portal'])")" "(True, 'ar')"
check "agreements: 5 draft texts created switched off" "$(api GET /api/agreements | jq_ "(len(d['data']), any(a['isActive'] for a in d['data']))")" "(5, False)"
AWJ=$(mktemp); login_as 01066660099 Wallet2026A "$AWJ" >/dev/null
apend() { curl -s -b "$AWJ" "$B/api/agreements/pending"; }
check "nothing to accept while every agreement is off" "$(apend | jq_ "len(d['data'])")" "0"
PR=$(M "SELECT id FROM Agreement WHERE \`key\`='parent-rules'"); MC=$(M "SELECT id FROM Agreement WHERE \`key\`='media-consent'")
api PATCH /api/agreements/$PR '{"isActive":true}' >/dev/null; api PATCH /api/agreements/$MC '{"isActive":true}' >/dev/null
check "switched on → the parent must accept 2 (blocking)" "$(apend | jq_ "(len(d['data']), all(a['blocking'] for a in d['data']))")" "(2, True)"
check "accepting an old version is refused" "$(curl -s -b "$AWJ" -X POST -H 'Content-Type: application/json' -d "{\"agreementId\":\"$PR\",\"version\":99}" $B/api/agreements/pending | jq_ "d['success']")" "False"
for A in $PR $MC; do curl -s -b "$AWJ" -X POST -H 'Content-Type: application/json' -d "{\"agreementId\":\"$A\",\"version\":1}" $B/api/agreements/pending >/dev/null; done
check "accepted both → nothing pending; proof stored (version + device)" "$(apend | jq_ "len(d['data'])")/$(M "SELECT COUNT(*) FROM AgreementAcceptance a JOIN Guardian g ON g.userId=a.userId WHERE g.phoneNumber='01066660099' AND a.version=1 AND a.userAgent IS NOT NULL")" "0/2"
check "editing the text publishes version 2" "$(api PATCH /api/agreements/$PR '{"bodyEn":"New rules text v2 for the e2e test.","graceDays":0}' | jq_ "d['data']['version']")" "2"
check "the parent must accept version 2 again" "$(apend | jq_ "[(a['key'], a['updated'], a['blocking']) for a in d['data']]")" "[('parent-rules', True, True)]"
api PATCH /api/agreements/$PR '{"graceDays":3,"bodyEn":"New rules text v3 for the e2e test."}' >/dev/null
check "with grace days a new version only reminds (not blocking)" "$(apend | jq_ "[(a['version'], a['blocking']) for a in d['data']]")" "[(3, False)]"
check "who accepted / pending + CSV export" "$(api GET /api/agreements/$MC | jq_ "d['data']['accepted']>=1")/$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$B/api/agreements/$MC?format=csv")" "True/200"
check "secretary cannot edit agreements" "$(secapi PATCH /api/agreements/$PR '{"isActive":false}' | jq_ "d['success']")" "False"
api PATCH /api/agreements/$PR '{"isActive":false}' >/dev/null; api PATCH /api/agreements/$MC '{"isActive":false}' >/dev/null
api PUT /api/platform/settings '{"modules":{"lms":false},"language":{"staff":"en","portal":"en"}}' >/dev/null
check "staff-only 'no marketing' flag on a student" "$(api PUT /api/students/$W1/marketing '{"noMarketing":true}' | jq_ "d['data']['noMarketing']")/$(M "SELECT noMarketing FROM Student WHERE id='$W1'")" "True/1"
check "a parent cannot read the marketing flag" "$(curl -s -o /dev/null -w '%{http_code}' -b "$AWJ" $B/api/students/$W1/marketing)" "403"
rm -f "$AWJ"

echo "== 30. LMS L1: curriculum library (versions, sessions, blocks, review, publish, export/import)"
CL=$NLEVEL
CLN=$(M "SELECT numberOfSessions FROM Level WHERE id='$CL'")
check "secretary cannot write curriculum" "$(secapi POST /api/curriculum/levels/$CL '{}' | jq_ "d['success']")" "False"
E1=$(api POST /api/curriculum/levels/$CL '{"notes":"first"}' | jq_ "d['data']['id']")
check "new blank version = v1 draft with one empty session per planned session" "$(M "SELECT CONCAT(number,'/',status) FROM CurriculumEdition WHERE id='$E1'")/$(M "SELECT COUNT(*) FROM CurriculumSession WHERE editionId='$E1'")" "1/DRAFT/$CLN"
check "tree shows the level with a draft" "$(api GET /api/curriculum/tree | jq_ "[l['draftCount'] for t in d['data']['tree'] for c in t['courses'] for l in c['levels'] if l['id']=='$CL'][0]")" "1"
S1=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E1' AND number=1")
check "text block added" "$(api POST /api/curriculum/sessions/$S1/blocks '{"type":"TEXT","data":{"textEn":"# Hello\n**robots**","textAr":"مرحبا"}}' | jq_ "d['success']")" "True"
check "instructor-only block added" "$(api POST /api/curriculum/sessions/$S1/blocks '{"type":"CODE","audience":"INSTRUCTOR","data":{"language":"python","code":"print(1)"}}' | jq_ "d['success']")" "True"
check "video by YouTube link accepted" "$(api POST /api/curriculum/sessions/$S1/blocks '{"type":"VIDEO","data":{"url":"https://youtu.be/dQw4w9WgXcQ"}}' | jq_ "d['success']")" "True"
check "embed from a site outside the allow-list refused" "$(api POST /api/curriculum/sessions/$S1/blocks '{"type":"EMBED","data":{"url":"https://evil.example.com/x"}}' | jq_ "d['success']")" "False"
check "javascript: link refused" "$(api POST /api/curriculum/sessions/$S1/blocks '{"type":"LINK","data":{"url":"javascript:alert(1)"}}' | jq_ "d['success']")" "False"
api PATCH /api/curriculum/sessions/$S1 '{"titleEn":"Meet the robot","titleAr":"تعرف على الروبوت","instructorNotes":"secret tip"}' >/dev/null
check "student preview hides instructor notes and instructor-only blocks" "$(api GET "/api/curriculum/sessions/$S1?as=STUDENT" | jq_ "(len(d['data']['blocks']), d['data']['session']['instructorNotes'])")" "(2, None)"
check "instructor view shows everything" "$(api GET "/api/curriculum/sessions/$S1" | jq_ "(len(d['data']['blocks']), d['data']['session']['instructorNotes'])")" "(3, 'secret tip')"
REV=$(api GET /api/curriculum/sessions/$S1 | jq_ "','.join('\"%s\"' % b['id'] for b in reversed(d['data']['blocks']))")
api PUT /api/curriculum/sessions/$S1/blocks "{\"ids\":[$REV]}" >/dev/null
check "blocks reordered" "$(api GET /api/curriculum/sessions/$S1 | jq_ "d['data']['blocks'][0]['type']")" "VIDEO"
check "send for review refused while sessions have no title" "$(api PATCH /api/curriculum/editions/$E1 '{"action":"submit"}' | jq_ "d['error']['code']")" "INCOMPLETE"
M "UPDATE CurriculumSession SET titleEn=CONCAT('Lesson ',number) WHERE editionId='$E1' AND titleEn=''"
check "sent for review" "$(api PATCH /api/curriculum/editions/$E1 '{"action":"submit"}' | jq_ "d['data']['status']")" "IN_REVIEW"
check "a version in review is locked" "$(api PATCH /api/curriculum/sessions/$S1 '{"titleEn":"x"}' | jq_ "d['error']['code']")" "LOCKED"
check "review comment added" "$(api POST /api/curriculum/sessions/$S1/comments '{"body":"Add a picture of the kit"}' | jq_ "d['success']")" "True"
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.30
check "instructor cannot see a version that is not published" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ" $B/api/curriculum/editions/$E1)" "404"
check "published" "$(api PATCH /api/curriculum/editions/$E1 '{"action":"publish"}' | jq_ "d['data']['status']")" "PUBLISHED"
check "instructor of this level reads the published session (with notes)" "$(curl -s -b "$TJ" $B/api/curriculum/sessions/$S1 | jq_ "(d['data']['session']['instructorNotes'], d['data']['editable'])")" "('secret tip', False)"
check "instructor cannot write curriculum" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{}' $B/api/curriculum/levels/$CL | jq_ "d['success']")" "False"
TTREE=$(curl -s -b "$TJ" $B/api/curriculum/tree)
check "instructor's tree has his group's level" "$(echo "$TTREE" | jq_ "'$CL' in [l['id'] for t in d['data']['tree'] for c in t['courses'] for l in c['levels']]")" "True"
ALLLV=$(api GET /api/curriculum/tree | jq_ "sum(len(c['levels']) for t in d['data']['tree'] for c in t['courses'])"); TLV=$(echo "$TTREE" | jq_ "sum(len(c['levels']) for t in d['data']['tree'] for c in t['courses'])")
check "instructor sees fewer levels than the admin" "$([ "$TLV" -lt "$ALLLV" ] && echo yes || echo "no ($TLV vs $ALLLV)")" "yes"
rm -f "$TJ"
E2=$(api POST /api/curriculum/levels/$CL "{\"copyFromId\":\"$E1\"}" | jq_ "d['data']['id']")
check "new version copies sessions and blocks" "$(M "SELECT number FROM CurriculumEdition WHERE id='$E2'")/$(M "SELECT COUNT(*) FROM CurriculumBlock b JOIN CurriculumSession s ON s.id=b.sessionId WHERE s.editionId='$E2'")" "2/3"
api PATCH /api/curriculum/editions/$E2 '{"action":"publish"}' >/dev/null
check "publishing v2 archives v1 (still readable)" "$(M "SELECT status FROM CurriculumEdition WHERE id='$E1'")/$(api GET /api/curriculum/editions/$E1 | jq_ "d['success']")" "ARCHIVED/True"
check "a published version cannot be deleted" "$(api DELETE /api/curriculum/editions/$E2 | jq_ "d['success']")" "False"
EXP=$(curl -s -b "$JAR" $B/api/curriculum/editions/$E2/export)
check "export file" "$(echo "$EXP" | jq_ "(d['format'], len(d['sessions']))")" "('technova-curriculum-v1', $CLN)"
E3=$(api POST /api/curriculum/levels/$CL/import "$EXP" | jq_ "d['data']['id']")
check "import = new draft with the same content" "$(M "SELECT CONCAT(number,'/',status) FROM CurriculumEdition WHERE id='$E3'")/$(M "SELECT COUNT(*) FROM CurriculumBlock b JOIN CurriculumSession s ON s.id=b.sessionId WHERE s.editionId='$E3'")" "3/DRAFT/3"
check "a file that is not a curriculum is refused" "$(api POST /api/curriculum/levels/$CL/import '{"format":"x","sessions":[]}' | jq_ "d['success']")" "False"
S3=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E3' AND number=1")
api DELETE /api/curriculum/sessions/$S3 >/dev/null
check "removing a session renumbers the rest" "$(M "SELECT CONCAT(COUNT(*),'/',MIN(number),'/',MAX(number)) FROM CurriculumSession WHERE editionId='$E3'")" "$((CLN-1))/1/$((CLN-1))"
check "duplicate a session = copy right after it" "$(api POST /api/curriculum/sessions/$(M "SELECT id FROM CurriculumSession WHERE editionId='$E3' AND number=1") | jq_ "d['success']")/$(M "SELECT CONCAT(COUNT(*),'/',MAX(number)) FROM CurriculumSession WHERE editionId='$E3'")/$(M "SELECT titleEn LIKE '%(copy)' FROM CurriculumSession WHERE editionId='$E3' AND number=2")" "True/$CLN/$CLN/1"
check "secretary cannot delete a draft" "$(secapi DELETE /api/curriculum/editions/$E3 | jq_ "d['success']")" "False"
check "draft deleted with its content" "$(api DELETE /api/curriculum/editions/$E3 | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM CurriculumSession WHERE editionId='$E3'")" "True/0"
SUBJ=$(M "SELECT subjectId FROM Level WHERE id='$CL'")
check "course skill added" "$(api POST /api/curriculum/skills "{\"subjectId\":\"$SUBJ\",\"nameEn\":\"Sensors\",\"nameAr\":\"الحساسات\"}" | jq_ "d['data']['nameEn']")" "Sensors"
check "secretary cannot add skills" "$(secapi POST /api/curriculum/skills "{\"subjectId\":\"$SUBJ\",\"nameEn\":\"X\"}" | jq_ "d['success']")" "False"
check "upload signature only for authors" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" -X POST $B/api/curriculum/media/sign)" "403"

echo "== 31. LMS L2: lessons open for students (attendance / instructor / modes), protection log, parent summary"
LG=$(mkgroup "E2E Lessons" "$CL")
api POST /api/groups/$LG/instructor "{\"teacherId\":\"$CALT\"}" >/dev/null
LK=$(mkstu LessonKid 01066660111 Huda 01066660119); LO=$(mkstu LessonOther 01066660112 Huda2 01066660118)
api POST /api/groups/$LG/students "{\"studentId\":\"$LK\"}" >/dev/null
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LKJ=$(mktemp)
login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ" 10.0.1.41
LOR=$(api POST /api/students/$LO/portal-password '{"target":"student"}'); LOJ=$(mktemp)
login_jar "$(echo "$LOR" | jq_ "d['data']['loginId']")" "$(echo "$LOR" | jq_ "d['data']['password']")" "$LOJ" 10.0.1.42
LGU=$(M "SELECT id FROM Guardian WHERE phoneNumber='01066660119'")
LPW=$(api POST /api/students/$LK/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$LGU\"}" | jq_ "d['data']['password']"); LPJ=$(mktemp)
login_jar 01066660119 "$LPW" "$LPJ" 10.0.1.43
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.44
kget() { curl -s -b "$LKJ" "$B$1"; }
OPEN() { kget /api/lessons/my | jq_ "[s['number'] for g in d['data']['groups'] for s in g['sessions'] if s['open']]"; }
check "lessons are off for students while the LMS module is off" "$(kget /api/lessons/my | jq_ "d['error']['code']")" "MODULE_OFF"
api PUT /api/platform/settings '{"modules":{"lms":true}}' >/dev/null
check "student sees his group with the published curriculum (v2), nothing open before any session" "$(kget /api/lessons/my | jq_ "(len(d['data']['groups']), d['data']['groups'][0]['edition']['number'], d['data']['kidMode'])")/$(OPEN)" "(1, 2, False)/[]"
check "instructor gets the group's lesson plan" "$(curl -s -b "$TJ" $B/api/groups/$LG/lessons | jq_ "(d['data']['mode'], d['data']['range']['from'])")" "('ATTENDANCE', 1)"
check "secretary gets no lesson plan (attendance only)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/groups/$LG/lessons)" "403"
LKE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LK' AND classSectionId='$LG'")
sess $LG "$(D -1)" "$(rec $LKE PRESENT)" >/dev/null
check "attendance recorded → lesson 1 opens" "$(OPEN)" "[1]"
check "group pinned to the version it started with" "$(M "SELECT curriculumEditionId FROM ClassSection WHERE id='$LG'")" "$E2"
L1=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E2' AND number=1"); L2=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E2' AND number=2")
LES=$(kget "/api/lessons/$L1?g=$LG")
check "student opens lesson 1: student view only + his name as watermark" "$(echo "$LES" | jq_ "(len(d['data']['blocks']), 'instructorNotes' in d['data']['session'], any(b['audience']=='INSTRUCTOR' for b in d['data']['blocks']), 'LessonKid' in d['data']['watermark'])")" "(2, False, False, True)"
check "opening is logged (who / what / when)" "$(M "SELECT COUNT(*) FROM LessonView WHERE sessionId='$L1' AND kind='SESSION' AND studentId='$LK'")" "1"
check "lesson 2 still locked" "$(kget "/api/lessons/$L2?g=$LG" | jq_ "d['error']['code']")" "LOCKED"
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"sessionNumber":2,"action":"open"}' $B/api/groups/$LG/lessons >/dev/null
check "instructor opens lesson 2 early" "$(OPEN)" "[1, 2]"
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"sessionNumber":1,"action":"lock"}' $B/api/groups/$LG/lessons >/dev/null
check "instructor locks lesson 1" "$(OPEN)/$(kget "/api/lessons/$L1?g=$LG" | jq_ "d['error']['code']")" "[2]/LOCKED"
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"sessionNumber":1,"action":"auto"}' $B/api/groups/$LG/lessons >/dev/null
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"sessionNumber":2,"action":"auto"}' $B/api/groups/$LG/lessons >/dev/null
check "back to automatic" "$(OPEN)" "[1]"
LB=$(echo "$LES" | jq_ "d['data']['blocks'][0]['id']")
IB=$(M "SELECT b.id FROM CurriculumBlock b WHERE b.sessionId='$L1' AND b.audience='INSTRUCTOR' LIMIT 1")
check "student ticks an item as done" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"blockId\":\"$LB\",\"done\":true}" $B/api/lessons/progress | jq_ "d['success']")/$(kget /api/lessons/my | jq_ "[s['done'] for g in d['data']['groups'] for s in g['sessions'] if s['number']==1][0]")" "True/1"
check "an instructor-only item cannot be ticked / reached" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"blockId\":\"$IB\",\"done\":true}" $B/api/lessons/progress | jq_ "d['success']")" "False"
check "a student of another group cannot open the lesson" "$(curl -s -b "$LOJ" "$B/api/lessons/$L1?g=$LG" | jq_ "d['success']")" "False"
E3N=$(api POST /api/curriculum/levels/$CL "{\"copyFromId\":\"$E2\"}" | jq_ "d['data']['id']"); api PATCH /api/curriculum/editions/$E3N '{"action":"publish"}' >/dev/null
check "panel tells about a newer published version" "$(api GET /api/groups/$LG/lessons | jq_ "(d['data']['edition']['number'], d['data']['newerEdition']['number'])")" "(2, 3)"
check "instructor cannot move the group to the new version" "$(curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"useLatest":true}' $B/api/groups/$LG/lessons | jq_ "d['success']")" "False"
check "manager moves the group to v3; the student's tick follows" "$(api PATCH /api/groups/$LG/lessons '{"useLatest":true}' | jq_ "d['data']['ticksMoved']")/$(M "SELECT curriculumEditionId FROM ClassSection WHERE id='$LG'")/$(kget /api/lessons/my | jq_ "([s['done'] for g in d['data']['groups'] for s in g['sessions'] if s['number']==1][0], d['data']['groups'][0]['edition']['number'])")" "1/$E3N/(1, 3)"
L1=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E3N' AND number=1")
curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"sessionNumber":1,"body":"Bring your kit next time"}' $B/api/groups/$LG/lessons/notes >/dev/null
check "group note from the instructor shows in the lesson" "$(kget "/api/lessons/$L1?g=$LG" | jq_ "[n['body'] for n in d['data']['notes']]")" "['Bring your kit next time']"
check "instructor cannot change how lessons open (managers only)" "$(curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"mode":"ALL"}' $B/api/groups/$LG/lessons | jq_ "d['success']")" "False"
api PATCH /api/groups/$LG/lessons '{"mode":"ALL"}' >/dev/null
check "admin sets this group to 'all at once'" "$(OPEN | python -c "import sys,ast;print(len(ast.literal_eval(sys.stdin.read())))")" "$CLN"
api PATCH /api/groups/$LG/lessons '{"mode":null}' >/dev/null
api PUT /api/lessons/settings '{"settings":{"unlockMode":"MANUAL","watermark":true,"kidModeMaxAge":7}}' >/dev/null
check "company default 'instructor opens' → nothing open by itself" "$(OPEN)" "[]"
api PUT /api/lessons/settings "{\"level\":{\"id\":\"$CL\",\"mode\":\"ATTENDANCE\"}}" >/dev/null
check "level's own mode wins over the company default" "$(OPEN)" "[1]"
api PUT /api/lessons/settings "{\"level\":{\"id\":\"$CL\",\"mode\":null},\"settings\":{\"unlockMode\":\"ATTENDANCE\",\"watermark\":true,\"kidModeMaxAge\":7}}" >/dev/null
check "secretary cannot change LMS settings" "$(secapi PUT /api/lessons/settings '{"settings":{"unlockMode":"ALL","watermark":false,"kidModeMaxAge":7}}' | jq_ "d['success']")" "False"
check "parent sees what was learned (titles), read-only" "$(curl -s -b "$LPJ" "$B/api/lessons/my?s=$LK" | jq_ "(d['data']['mode'], [s['number'] for g in d['data']['groups'] for s in g['sessions']])")" "('PARENT', [1])"
check "parent cannot open the lesson content itself" "$(curl -s -b "$LPJ" "$B/api/lessons/$L1?g=$LG&s=$LK" | jq_ "d['success']")" "False"
check "parent cannot read another family's child" "$(curl -s -b "$LPJ" "$B/api/lessons/my?s=$LO" | jq_ "d['success']")" "False"
check "staff do not use the student lesson pages" "$(api GET /api/lessons/my | jq_ "d['success']")" "False"
api PUT /api/platform/settings '{"modules":{"lms":false}}' >/dev/null
rm -f "$LKJ" "$LOJ" "$LPJ" "$TJ"

echo
echo "RESULT: $PASS passed, $FAIL failed"
grep -E "⨯|Error:" /d/tn-e2e-app.log | grep -v webpackBuildWorker | head -5
[ $FAIL -eq 0 ]
