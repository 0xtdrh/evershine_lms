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
"$MYSQL_DIR/bin/mysql.exe" --no-defaults -h 127.0.0.1 -P $DB_PORT -u root e2e -e "REPLACE INTO AppSetting (\`key\`, value, updatedAt) VALUES ('security.settings', '{\"twoFactorEnabled\":false,\"twoFactorRoles\":[\"SUPER_ADMIN\",\"ADMIN\"],\"idleMinutes\":0}', NOW())"
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
  DATABASE_URL="$URL" AUTH_SECRET="$SECRET" NEXTAUTH_SECRET="$SECRET" NEXTAUTH_URL="$B" AUTH_TRUST_HOST=true PAYMOB_HMAC_SECRET="e2e-paymob-hmac" CRON_SECRET="e2e-cron" VIDEO_STORAGE=local npx next start -p $APP_PORT > /d/tn-e2e-app.log 2>&1 &
else
DATABASE_URL="$URL" AUTH_SECRET="$SECRET" NEXTAUTH_SECRET="$SECRET" NEXTAUTH_URL="$B" PAYMOB_HMAC_SECRET="e2e-paymob-hmac" CRON_SECRET="e2e-cron" VIDEO_STORAGE=local NODE_OPTIONS="--max-old-space-size=6144" npx next dev -p $APP_PORT > /d/tn-e2e-app.log 2>&1 &
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
# Dates are built in CAIRO time like the app (cairoToday): between 21:00 and 24:00 UTC Cairo is already on the next
# day. Git Bash has no zoneinfo, so Node gives the offset once (2 h winter / 3 h summer time).
CAIRO_OFF=$(node -e "const d=new Date();const c=new Date(d.toLocaleString('en-US',{timeZone:'Africa/Cairo'}));const u=new Date(d.toLocaleString('en-US',{timeZone:'UTC'}));console.log(Math.round((c-u)/3600000))")
cairo() { date -u -d "@$(( $(date -u +%s) + CAIRO_OFF * 3600 + ${2:-0} * 86400 ))" "$1"; }
D() { cairo +%F "$1"; }
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
check "the same instructor at the same time in two groups is refused (owner rule, batch 4)" "$(api POST /api/groups/$SG2/instructor "{\"teacherId\":\"$CALT\"}" | jq_ "d['error']['code']")" "TEACHER_PROBLEM"
api POST /api/groups/$SG2/instructor "{\"teacherId\":\"$CALT\",\"force\":true}" >/dev/null
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
check "holiday notice in Arabic too, with the next session (the day after)" "$(M "SELECT COUNT(*) FROM Notification WHERE type='HOLIDAY' AND relatedId='$PH' AND titleAr LIKE 'إجازة:%' AND messageAr LIKE '%الحصة الجاية%' AND message LIKE '%next session is%'")" "$(M "SELECT COUNT(*) FROM Notification WHERE type='HOLIDAY' AND relatedId='$PH'")"
check "holiday notice reaches the student too" "$(M "SELECT COUNT(*) FROM Notification n JOIN Student s ON s.userId=n.userId WHERE s.id='$PHS' AND n.type='HOLIDAY'")" "1"
check "portal 'next sessions': the holiday shows as postponed" "$(api GET /api/students/$PHS/upcoming-sessions | jq_ "[x['status'] for x in d['data']['sessions'] if x['date']=='$(D 1)']")" "['HOLIDAY']"
check "extra session added on the holiday evening" "$(api POST /api/groups/$PH/extra-sessions "{\"date\":\"$(D 1)\",\"time\":\"20:00\",\"reason\":\"make up\"}" | jq_ "d['success']")" "True"
# 2026-10-24 live test: the instructor's day (absences, substitutes, "my week") follows holidays and makeup sessions too
api POST /api/groups/$PH/instructor "{\"teacherId\":\"$CALT\",\"force\":true}" >/dev/null
check "instructor's week: the holiday's usual session is gone, the makeup session is there" "$(api GET "/api/teachers/$CALT/my-week?days=4" | jq_ "[(s['time'], s.get('isExtra', False)) for day in d['data'] if day['date']=='$(D 1)' for s in day['sessions'] if s['classSectionId']=='$PH']")" "[('20:00', True)]"
CAL=$(api GET "/api/groups/schedule?from=$(D -1)&to=$(D 5)")
check "extra session counts: the month ends a day earlier" "$(echo "$CAL" | jq_ "[s['date'] for s in d['data']['sessions'] if s['groupId']=='$PH' and s['isLastOfCycle']]==['$(D 2)']")" "True"
check "makeup session: families + student told (both languages)" "$(M "SELECT COUNT(*)>=1, SUM(titleAr='حصة تعويضية') FROM Notification WHERE type='MAKEUP_SESSION' AND relatedId='$PH'" | tr '	' '/')" "1/$(M "SELECT COUNT(*) FROM Notification WHERE type='MAKEUP_SESSION' AND relatedId='$PH'")"
check "portal 'next sessions': the makeup session is marked" "$(api GET /api/students/$PHS/upcoming-sessions | jq_ "[x['time'] for x in d['data']['sessions'] if x['isExtra']]")" "['20:00']"
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
RD2=$(D -2) # kept: the run may pass midnight before the rating below
sess $WB "$RD2" "$(rec $W1E LATE),$(rec $W2E ABSENT)" >/dev/null
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
check "rating 🙁 → managers alerted + follow-up" "$(ppost POST /api/ratings/parent "{\"type\":\"session\",\"studentId\":\"$W1\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$RD2\",\"rating\":1,\"comment\":\"too noisy\"}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM Notification WHERE type='LOW_RATING' AND relatedId='$W1'" | python -c "import sys;print(int(sys.stdin.read())>=1)")/$(M "SELECT COUNT(*) FROM ContactLog WHERE studentId='$W1' AND reason='COMPLAINT'")" "True/True/1"
check "the same session cannot be rated twice" "$(ppost POST /api/ratings/parent "{\"type\":\"session\",\"studentId\":\"$W1\",\"classSectionId\":\"$WB\",\"sessionDate\":\"$RD2\",\"rating\":4}" | jq_ "d['success']")" "False"
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
TODAYMD=$(cairo +%m-%d)
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
check "agreements: 9 draft texts created switched off" "$(api GET /api/agreements | jq_ "(len(d['data']), any(a['isActive'] for a in d['data']))")" "(9, False)"
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
api POST /api/groups/$LG/instructor "{\"teacherId\":\"$CALT\",\"force\":true}" >/dev/null
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

echo "== 32. LMS L3: homework — auto questions, rubric grading, return + resubmit, in class, late penalty, level scores"
RUB=$(api POST /api/rubrics '{"nameEn":"E2E Project rubric","criteria":[{"id":"idea","titleEn":"Idea","levels":[{"labelEn":"Great","points":4},{"labelEn":"OK","points":2}]},{"id":"build","titleEn":"Build","levels":[{"labelEn":"Works","points":6},{"labelEn":"Partly","points":3}]}]}' | jq_ "d['data']['id']")
check "rubric saved in the library (max 10)" "$(api GET /api/rubrics | jq_ "[r['maxPoints'] for r in d['data'] if r['id']=='$RUB']")" "[10]"
check "secretary cannot write rubrics" "$(secapi POST /api/rubrics '{"nameEn":"x","criteria":[{"id":"a","levels":[{"points":1}]}]}' | jq_ "d['success']")" "False"
E4=$(api POST /api/curriculum/levels/$CL "{\"copyFromId\":\"$E3N\"}" | jq_ "d['data']['id']")
S41=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E4' AND number=1")
check "automatic grading without questions is refused" "$(api POST /api/curriculum/sessions/$S41/blocks '{"type":"ASSIGNMENT","data":{"kinds":["PHOTO"],"gradingMode":"AUTO"}}' | jq_ "d['success']")" "False"
A1=$(api POST /api/curriculum/sessions/$S41/blocks '{"type":"ASSIGNMENT","titleEn":"Quick check","data":{"kinds":[],"gradingMode":"AUTO","questions":[{"id":"q1","type":"SINGLE","textEn":"Which pin?","options":[{"id":"a","textEn":"13"},{"id":"b","textEn":"7"}],"correct":["a"],"points":2},{"id":"q2","type":"NUMBER","textEn":"How many LEDs?","correct":[3],"points":2}]}}' | jq_ "d['data']['id']")
A2=$(api POST /api/curriculum/sessions/$S41/blocks "{\"type\":\"ASSIGNMENT\",\"titleEn\":\"Explain your robot\",\"data\":{\"kinds\":[\"TEXT\",\"LINK\"],\"scale\":\"RUBRIC\",\"rubricId\":\"$RUB\",\"rubric\":{\"nameEn\":\"E2E Project rubric\",\"criteria\":[{\"id\":\"idea\",\"titleEn\":\"Idea\",\"levels\":[{\"labelEn\":\"Great\",\"points\":4},{\"labelEn\":\"OK\",\"points\":2}]},{\"id\":\"build\",\"titleEn\":\"Build\",\"levels\":[{\"labelEn\":\"Works\",\"points\":6},{\"labelEn\":\"Partly\",\"points\":3}]}]}}}" | jq_ "d['data']['id']")
A3=$(api POST /api/curriculum/sessions/$S41/blocks '{"type":"ASSIGNMENT","titleEn":"Wire it in class","data":{"kinds":["IN_CLASS"],"maxPoints":5}}' | jq_ "d['data']['id']")
FP=$(api POST /api/curriculum/sessions/$S41/blocks '{"type":"ASSIGNMENT","titleEn":"Final project","data":{"kinds":["LINK"],"maxPoints":10,"finalProject":true}}' | jq_ "d['data']['id']")
check "4 assignments added to the lesson" "$(M "SELECT COUNT(*) FROM CurriculumBlock WHERE sessionId='$S41' AND type='ASSIGNMENT'")" "4"
api PATCH /api/curriculum/editions/$E4 '{"action":"publish"}' >/dev/null
api PATCH /api/groups/$LG/lessons '{"useLatest":true}' >/dev/null
api PUT /api/platform/settings '{"modules":{"lms":true}}' >/dev/null
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LKJ=$(mktemp)
login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ" 10.0.1.51
LPW=$(api POST /api/students/$LK/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$LGU\"}" | jq_ "d['data']['password']"); LPJ=$(mktemp); login_jar 01066660119 "$LPW" "$LPJ" 10.0.1.52
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.53
kput() { curl -s -b "$LKJ" -X PUT -H 'Content-Type: application/json' -d "$1" $B/api/assignments/item; }
tpost() { curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "$2" $B/api/assignments/submissions/$1; }
SUBID() { M "SELECT id FROM AssignmentSubmission WHERE blockId='$1' AND studentId='$LK'"; }
check "student's homework list: the 4 assignments of the open lesson, all to do" "$(curl -s -b "$LKJ" $B/api/assignments/my | jq_ "(sorted(set(i['status'] for g in d['data']['groups'] for i in g['items'])), sum(len(g['items']) for g in d['data']['groups']))")" "(['TODO'], 4)"
check "questions reach the student without the correct answers" "$(curl -s -b "$LKJ" "$B/api/assignments/item?g=$LG&b=$A1" | jq_ "any('correct' in q for q in d['data']['assignment']['questions'])")" "False"
check "draft saved automatically" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$A2\",\"text\":\"My robot follows a line\",\"submit\":false}" | jq_ "d['data']['status']")" "DRAFT"
check "a file from someone else's folder is refused" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$FP\",\"links\":[\"https://scratch.mit.edu/projects/1\"],\"files\":[{\"publicId\":\"x/other/file\",\"resourceType\":\"image\"}],\"submit\":true}" | jq_ "d['success']")" "False"
check "an http (not https) link is refused" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$FP\",\"links\":[\"http://x.com\"],\"submit\":true}" | jq_ "d['success']")" "False"
check "automatic questions graded at once (1 right, 1 wrong = 2/4)" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$A1\",\"answers\":{\"q1\":\"a\",\"q2\":\"4\"},\"submit\":true}" | jq_ "(d['data']['status'], float(d['data']['score']))")" "('GRADED', 2.0)"
check "student hands in the written + link homework" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$A2\",\"text\":\"My robot follows a line\",\"links\":[\"https://scratch.mit.edu/projects/123\"],\"submit\":true}" | jq_ "d['data']['status']")" "SUBMITTED"
check "lesson item counts as done after handing in" "$(M "SELECT COUNT(*) FROM LessonProgress WHERE studentId='$LK' AND blockId='$A2'")" "1"
check "secretary gets no gradebook" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/groups/$LG/assignments)" "403"
check "instructor's gradebook shows 1 to grade" "$(curl -s -b "$TJ" $B/api/groups/$LG/assignments | jq_ "[a['toGrade'] for a in d['data']['assignments'] if a['blockId']=='$A2'][0]")" "1"
S2=$(SUBID $A2)
check "sending back needs a note" "$(tpost $S2 '{"action":"return"}' | jq_ "d['success']")" "False"
check "instructor sends it back for changes" "$(tpost $S2 '{"action":"return","feedback":"Add a photo of the line"}' | jq_ "d['data']['status']")" "RETURNED"
check "student hands in again (try 2)" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$A2\",\"text\":\"Now with more detail\",\"links\":[\"https://scratch.mit.edu/projects/123\"],\"submit\":true}" | jq_ "d['data']['status']")/$(M "SELECT attempt FROM AssignmentSubmission WHERE id='$S2'")" "SUBMITTED/2"
check "rubric needs every line" "$(tpost $S2 '{"action":"grade","rubricPicks":{"idea":0}}' | jq_ "d['success']")" "False"
check "graded with the rubric (4 + 3 = 7)" "$(tpost $S2 '{"action":"grade","rubricPicks":{"idea":0,"build":1},"feedback":"Nice idea"}' | jq_ "float(d['data']['score'])")" "7.0"
check "no third try (max 2)" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$A2\",\"text\":\"again\",\"submit\":true}" | jq_ "d['error']['code']")" "NO_ATTEMPTS"
check "done in class — full marks for the group" "$(curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d "{\"blockId\":\"$A3\",\"inClass\":[\"$LK\"],\"fullMarks\":true}" $B/api/groups/$LG/assignments | jq_ "d['success']")/$(M "SELECT CONCAT(status,'/',score) FROM AssignmentSubmission WHERE blockId='$A3' AND studentId='$LK'")" "True/GRADED/5"
api PUT /api/assignments/policies '{"company":{"late":"MARK_LATE","latePenaltyPct":20,"resubmit":true,"maxAttempts":2,"excuseExtensionDays":7,"parentCanSubmit":true}}' >/dev/null
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d "{\"blockId\":\"$FP\",\"dueAt\":\"$(D -2)T10:00:00.000Z\"}" $B/api/groups/$LG/assignments >/dev/null
check "late hand-in is marked late with the 20% penalty" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$FP\",\"links\":[\"https://scratch.mit.edu/projects/999\"],\"submit\":true}" | jq_ "d['success']")/$(M "SELECT CONCAT(late,'/',CAST(latePenaltyPct AS SIGNED)) FROM AssignmentSubmission WHERE blockId='$FP' AND studentId='$LK'")" "True/1/20"
check "10 points minus 20% = 8" "$(tpost $(SUBID $FP) '{"action":"grade","points":10}' | jq_ "float(d['data']['score'])")" "8.0"
check "changing the automatic score needs a reason" "$(tpost $(SUBID $A1) '{"action":"grade","autoOverride":4}' | jq_ "d['success']")" "False"
check "automatic score changed with a reason" "$(tpost $(SUBID $A1) '{"action":"grade","autoOverride":4,"overrideReason":"q2 photo shows 4 LEDs, question was unclear"}' | jq_ "float(d['data']['score'])")" "4.0"
check "parent sees grades and feedback" "$(curl -s -b "$LPJ" "$B/api/assignments/my?s=$LK" | jq_ "sorted((i['status'], float(i['score'])) for g in d['data']['groups'] for i in g['items'])")" "[('GRADED', 4.0), ('GRADED', 5.0), ('GRADED', 7.0), ('GRADED', 8.0)]"
check "parent cannot hand in for an older child" "$(curl -s -b "$LPJ" -X PUT -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"blockId\":\"$A2\",\"studentId\":\"$LK\",\"text\":\"x\",\"submit\":true}" $B/api/assignments/item | jq_ "d['success']")" "False"
check "level result gets homework 90% (4/4, 7/10, 5/5) and project 80% from the LMS" "$(api GET "/api/level-results?classSectionId=$LG&subjectId=$SUBJ" | jq_ "[(float(r['lms']['homework']), float(r['lms']['project'])) for r in d['data']['rows'] if r['student']['id']=='$LK'][0]")" "(90.0, 80.0)"
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"policy":{"late":"CLOSED","latePenaltyPct":0,"resubmit":true,"maxAttempts":3,"excuseExtensionDays":0,"parentCanSubmit":false}}' $B/api/groups/$LG/assignments >/dev/null
check "instructor cannot change the group's homework rules (managers only)" "$(M "SELECT COUNT(*) FROM AppSetting WHERE \`key\`='lms.assignments' AND CAST(value AS CHAR) LIKE '%$LG%'")" "0"
api PATCH /api/groups/$LG/assignments '{"policy":{"late":"CLOSED","latePenaltyPct":0,"resubmit":true,"maxAttempts":3,"excuseExtensionDays":0,"parentCanSubmit":false}}' >/dev/null
check "group rule 'closed after the due date' stops a late hand-in" "$(kput "{\"groupId\":\"$LG\",\"blockId\":\"$FP\",\"links\":[\"https://scratch.mit.edu/projects/1000\"],\"submit\":true}" | jq_ "d['error']['code']")" "CLOSED"
api PATCH /api/groups/$LG/assignments '{"policy":{"late":"MARK_LATE","latePenaltyPct":0,"resubmit":true,"maxAttempts":3,"excuseExtensionDays":0,"parentCanSubmit":false,"showAnswers":"AFTER_SUBMIT","showGrades":"AFTER_DUE"}}' >/dev/null
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d "{\"blockId\":\"$A2\",\"dueAt\":\"$(D 3)T10:00:00.000Z\"}" $B/api/groups/$LG/assignments >/dev/null
check "grade hidden until the due date (parent sees 'result on …')" "$(curl -s -b "$LPJ" "$B/api/assignments/my?s=$LK" | jq_ "[(i['score'], i['resultsAt'] is not None) for g in d['data']['groups'] for i in g['items'] if i['blockId']=='$A2'][0]")" "(None, True)"
check "grade + feedback hidden inside the homework too" "$(curl -s -b "$LKJ" "$B/api/assignments/item?g=$LG&b=$A2" | jq_ "(d['data']['submission']['score'], d['data']['submission']['feedback'], d['data']['gradesHiddenUntil'] is not None)")" "(None, None, True)"
check "correct answers shown after handing in (setting)" "$(curl -s -b "$LKJ" "$B/api/assignments/item?g=$LG&b=$A1" | jq_ "d['data']['answerKey']['q2']['correct']")" "[3]"
api PATCH /api/groups/$LG/assignments '{"policy":{"late":"MARK_LATE","latePenaltyPct":0,"resubmit":true,"maxAttempts":3,"excuseExtensionDays":0,"parentCanSubmit":false,"showAnswers":"NEVER","showGrades":"IMMEDIATE"}}' >/dev/null
check "'never' keeps the answers hidden; grade shows again" "$(curl -s -b "$LKJ" "$B/api/assignments/item?g=$LG&b=$A1" | jq_ "d['data']['answerKey']")/$(curl -s -b "$LKJ" "$B/api/assignments/item?g=$LG&b=$A2" | jq_ "float(d['data']['submission']['score'])")" "None/7.0"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "daily job sent 'new homework' once per assignment" "$(M "SELECT COUNT(*) FROM AssignmentNotice WHERE classSectionId='$LG' AND kind='NEW'")" "4"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "running the job again sends nothing twice" "$(M "SELECT COUNT(*) FROM AssignmentNotice WHERE classSectionId='$LG' AND kind='NEW'")" "4"
api PATCH /api/groups/$LG/assignments '{"policy":null}' >/dev/null
api PUT /api/assignments/policies '{"company":{"late":"MARK_LATE","latePenaltyPct":0,"resubmit":true,"maxAttempts":2,"excuseExtensionDays":7,"parentCanSubmit":true}}' >/dev/null
api PUT /api/platform/settings '{"modules":{"lms":false}}' >/dev/null
rm -f "$LKJ" "$LPJ" "$TJ"

echo "== 33. LMS L3 batch 2: code editor, Arduino checks, copying alert, projects gallery, reactions"
E5=$(api POST /api/curriculum/levels/$CL "{\"copyFromId\":\"$E4\"}" | jq_ "d['data']['id']")
S51=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E5' AND number=1")
PY=$(api POST /api/curriculum/sessions/$S51/blocks '{"type":"ASSIGNMENT","titleEn":"Add two numbers","data":{"kinds":["CODE"],"maxPoints":0,"gradingMode":"AUTO","code":{"language":"python","starter":"a = int(input())\n","tests":[{"id":"t1","input":"2\n3","expected":"5","points":2},{"id":"t2","input":"10\n5","expected":"15","points":3}]}}}' | jq_ "d['data']['id']")
ARD=$(api POST /api/curriculum/sessions/$S51/blocks '{"type":"ASSIGNMENT","titleEn":"Blink","data":{"kinds":["CODE"],"maxPoints":0,"gradingMode":"AUTO","code":{"language":"arduino"},"toolCheck":{"tool":"ARDUINO","rules":[{"id":"r1","kind":"HAS_SETUP_LOOP","points":2},{"id":"r2","kind":"BALANCED","points":1},{"id":"r3","kind":"USES_FUNCTION","value":"digitalWrite","points":2}]}}}' | jq_ "d['data']['id']")
check "code homework (Python tests) and Arduino homework (automatic checks) added" "$([ -n "$PY" ] && [ -n "$ARD" ] && echo yes)" "yes"
check "code homework needs a language" "$(api POST /api/curriculum/sessions/$S51/blocks '{"type":"ASSIGNMENT","data":{"kinds":["CODE"]}}' | jq_ "d['success']")" "False"
api PATCH /api/curriculum/editions/$E5 '{"action":"publish"}' >/dev/null
api PATCH /api/groups/$LG/lessons '{"useLatest":true}' >/dev/null
api POST /api/groups/$LG/students "{\"studentId\":\"$LO\"}" >/dev/null
LOE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LO' AND classSectionId='$LG'")
api PUT /api/platform/settings '{"modules":{"lms":true}}' >/dev/null
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LKJ=$(mktemp); login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ" 10.0.1.61
LOR=$(api POST /api/students/$LO/portal-password '{"target":"student"}'); LOJ=$(mktemp); login_jar "$(echo "$LOR" | jq_ "d['data']['loginId']")" "$(echo "$LOR" | jq_ "d['data']['password']")" "$LOJ" 10.0.1.62
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.63
WPJ=$(mktemp); login_as 01066660099 Wallet2026A "$WPJ" >/dev/null
put_as() { curl -s -b "$1" -X PUT -H 'Content-Type: application/json' -d "$2" $B/api/assignments/item; }
PYCODE='a = int(input())\nb = int(input())\n# add them up\nresult = a + b\nprint(result)\nprint(\"done adding the two numbers together\")'
check "Python hand-in with the browser's test run: 2 of 5 points, waits for the instructor (could be tampered)" "$(put_as "$LKJ" "{\"groupId\":\"$LG\",\"blockId\":\"$PY\",\"code\":\"$PYCODE\",\"codeResults\":[{\"id\":\"t1\",\"passed\":true},{\"id\":\"t2\",\"passed\":false},{\"id\":\"fake\",\"passed\":true}],\"submit\":true}" | jq_ "d['data']['status']")/$(M "SELECT CAST(autoScore AS SIGNED) FROM AssignmentSubmission WHERE blockId='$PY' AND studentId='$LK'")" "SUBMITTED/2"
check "Arduino code checked on the server and graded at once (5/5)" "$(put_as "$LKJ" "{\"groupId\":\"$LG\",\"blockId\":\"$ARD\",\"code\":\"void setup() { pinMode(13, OUTPUT); }\\nvoid loop() { digitalWrite(13, HIGH); delay(500); }\",\"submit\":true}" | jq_ "(d['data']['status'], float(d['data']['score']))")" "('GRADED', 5.0)"
check "broken Arduino code loses the bracket and function points (2/5)" "$(put_as "$LOJ" "{\"groupId\":\"$LG\",\"blockId\":\"$ARD\",\"code\":\"void setup() { pinMode(13, OUTPUT);\\nvoid loop() { analogWrite(9, 100); }\",\"submit\":true}" | jq_ "float(d['data']['score'])")" "2.0"
put_as "$LOJ" "{\"groupId\":\"$LG\",\"blockId\":\"$PY\",\"code\":\"$(echo "$PYCODE" | sed 's/# add them up/# sum/')\",\"codeResults\":[{\"id\":\"t1\",\"passed\":true},{\"id\":\"t2\",\"passed\":true}],\"submit\":true}" >/dev/null
SPY=$(M "SELECT id FROM AssignmentSubmission WHERE blockId='$PY' AND studentId='$LK'")
check "instructor sees the copying alert (almost the same code as a classmate)" "$(curl -s -b "$TJ" $B/api/assignments/submissions/$SPY | jq_ "[x['name'] for x in d['data']['similar'] if x['percent']>=80]")" "['LessonOther E2e']"
check "instructor confirms the code score and puts the project in the gallery" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"action":"grade","gallery":true,"feedback":"Clean code"}' $B/api/assignments/submissions/$SPY | jq_ "float(d['data']['score'])")/$(M "SELECT galleryStatus FROM AssignmentSubmission WHERE id='$SPY'")" "2.0/APPROVED"
check "a classmate (same group) sees it in the gallery" "$(curl -s -b "$LOJ" $B/api/gallery | jq_ "[i['firstName'] for i in d['data']]")" "['LessonKid']"
check "a family from another group does not (gallery rule = group)" "$(curl -s -b "$WPJ" $B/api/gallery | jq_ "len(d['data'])")" "0"
api PATCH /api/groups/$LG/assignments '{"policy":{"late":"MARK_LATE","latePenaltyPct":0,"resubmit":true,"maxAttempts":2,"excuseExtensionDays":7,"parentCanSubmit":true,"showAnswers":"AFTER_DUE","showGrades":"IMMEDIATE","gallery":"ALL"}}' >/dev/null
check "gallery rule 'everyone' → the other family sees it too" "$(curl -s -b "$WPJ" $B/api/gallery | jq_ "len(d['data'])")" "1"
M "UPDATE Student SET noMarketing=1 WHERE id='$LK'"
check "a 'no marketing' student is never shown outside the group" "$(curl -s -b "$WPJ" $B/api/gallery | jq_ "len(d['data'])")/$(curl -s -b "$LOJ" $B/api/gallery | jq_ "len(d['data'])")" "0/1"
M "UPDATE Student SET noMarketing=0 WHERE id='$LK'"
curl -s -b "$LOJ" -X POST -H 'Content-Type: application/json' -d "{\"submissionId\":\"$SPY\",\"emoji\":\"\ud83d\udc4f\"}" $B/api/gallery/react >/dev/null
check "emoji reaction counted" "$(M "SELECT COUNT(*) FROM GalleryReaction WHERE submissionId='$SPY'")/$(curl -s -b "$LKJ" $B/api/gallery | jq_ "sum(d['data'][0]['reactions'].values())")" "1/1"
curl -s -b "$LOJ" -X POST -H 'Content-Type: application/json' -d "{\"submissionId\":\"$SPY\",\"emoji\":\"\ud83d\udc4f\"}" $B/api/gallery/react >/dev/null
check "pressing it again removes it" "$(M "SELECT COUNT(*) FROM GalleryReaction WHERE submissionId='$SPY'")" "0"
check "no written comments / unknown reactions" "$(curl -s -b "$LOJ" -X POST -H 'Content-Type: application/json' -d "{\"submissionId\":\"$SPY\",\"emoji\":\"nice job\"}" $B/api/gallery/react | jq_ "d['success']")" "False"
check "voice note upload: instructor allowed (storage not set up locally), secretary refused" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ" -X POST $B/api/assignments/submissions/$SPY/audio)/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" -X POST $B/api/assignments/submissions/$SPY/audio)" "400/403"
check "a voice note from outside its folder is refused" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"action":"grade","feedbackAudio":{"publicId":"x/other/voice","resourceType":"video"}}' $B/api/assignments/submissions/$SPY | jq_ "d['success']")" "False"
api PATCH /api/groups/$LG/assignments '{"policy":null}' >/dev/null
api PUT /api/platform/settings '{"modules":{"lms":false}}' >/dev/null
rm -f "$LKJ" "$LOJ" "$TJ" "$WPJ"

echo "== 34. LMS L4: quizzes — code questions, tries, server timer, bank draw, final exam opened in class, code review, paper exam, level scores"
for i in 1 2 3; do api POST /api/questions "{\"subjectId\":\"$SUBJ\",\"levelId\":\"$CL\",\"difficulty\":1,\"question\":{\"id\":\"x\",\"type\":\"TRUE_FALSE\",\"textEn\":\"Bank question $i\",\"correct\":[\"true\"],\"points\":1}}" >/dev/null; done
check "question bank: 3 questions saved" "$(api GET "/api/questions?subjectId=$SUBJ&levelId=$CL" | jq_ "len(d['data'])")" "3"
check "secretary cannot write bank questions" "$(secapi POST /api/questions "{\"subjectId\":\"$SUBJ\",\"question\":{\"id\":\"x\",\"type\":\"SHORT\"}}" | jq_ "d['success']")" "False"
E6=$(api POST /api/curriculum/levels/$CL "{\"copyFromId\":\"$E5\"}" | jq_ "d['data']['id']")
S61=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E6' AND number=1")
QZ=$(api POST /api/curriculum/sessions/$S61/blocks '{"type":"QUIZ","titleEn":"Loops quiz","data":{"kind":"SESSION","timeLimitMin":10,"showAnswers":"AFTER_SUBMIT","shuffleQuestions":false,"questions":[
 {"id":"q1","type":"CODE_OUTPUT","textEn":"Output?","code":"for i in range(3):\n  print(i*2)","correct":["0\n2\n4"],"points":2},
 {"id":"q2","type":"FIND_BUG","textEn":"Bug?","code":"a = 1\nprint(b)","correct":[2],"points":2},
 {"id":"q3","type":"FILL_BLANK","textEn":"Fill","code":"for i in ___(5):\n  ___(i)","correct":["range","print"],"points":2},
 {"id":"q4","type":"PARSONS","textEn":"Order","items":[{"id":"a","textEn":"x = 1"},{"id":"b","textEn":"x += 1"},{"id":"c","textEn":"print(x)"}],"points":2},
 {"id":"q5","type":"MATCH_CODE","textEn":"Match","pairs":[{"id":"m1","left":"print(1)","right":"1"},{"id":"m2","left":"print(2)","right":"2"}],"points":2},
 {"id":"q6","type":"TRUE_FALSE","textEn":"Python counts from 0","correct":["true"],"points":1}]}}' | jq_ "d['data']['id']")
QB=$(api POST /api/curriculum/sessions/$S61/blocks '{"type":"QUIZ","titleEn":"Bank quiz","data":{"kind":"SESSION","timeLimitMin":5,"bank":{"count":2,"levelOnly":true}}}' | jq_ "d['data']['id']")
QF=$(api POST /api/curriculum/sessions/$S61/blocks '{"type":"QUIZ","titleEn":"Final exam","data":{"kind":"FINAL","questions":[
 {"id":"w1","type":"WRITE_CODE","textEn":"Write add(a,b)","points":4,"tests":[{"id":"t1","input":"","expected":"3","points":1}]},
 {"id":"s1","type":"SINGLE","textEn":"Which loop repeats forever?","options":[{"id":"o1","textEn":"while True"},{"id":"o2","textEn":"for i in range(3)"}],"correct":["o1"],"points":1}]}}' | jq_ "d['data']['id']")
check "a quiz without questions is refused" "$(api POST /api/curriculum/sessions/$S61/blocks '{"type":"QUIZ","data":{"questions":[]}}' | jq_ "d['success']")" "False"
api PATCH /api/curriculum/editions/$E6 '{"action":"publish"}' >/dev/null
api PATCH /api/groups/$LG/lessons '{"useLatest":true}' >/dev/null
api PUT /api/platform/settings '{"modules":{"lms":true}}' >/dev/null
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LKJ=$(mktemp); login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ" 10.0.1.71
LPW=$(api POST /api/students/$LK/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$LGU\"}" | jq_ "d['data']['password']"); LPJ=$(mktemp); login_jar 01066660119 "$LPW" "$LPJ" 10.0.1.72
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.73
# 2026-10-24: students sign in with an easy name (english first name + number) or the full registration number
LKREG=$(M "SELECT registrationNumber FROM Student WHERE id='$LK'"); LKJ2=$(mktemp); login_jar "$LKREG" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ2" 10.0.1.74
check "student login: the card gives the easy name; both it and the full registration number sign in" "$(echo "$LKR" | jq_ "d['data']['loginId'][:3]!='TN/' and '@' not in d['data']['loginId']")/$(curl -s -b "$LKJ" $B/api/auth/session | jq_ "d['user']['role']")/$(curl -s -b "$LKJ2" $B/api/auth/session | jq_ "d['user']['role']")" "True/STUDENT/STUDENT"
rm -f "$LKJ2"
check "the student page card shows how each one signs in (login names, no password)" "$(api GET /api/students/$LK/portal-password | jq_ "(d['data']['student']['registrationNumber']=='$LKREG', '01066660119' in [g['phone'] for g in d['data']['guardians']], 'password' in str(d))")" "(True, True, False)"
kq() { curl -s -b "$LKJ" "$B/api/quizzes/item?g=$LG&b=$1"; }
kstart() { curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"blockId\":\"$1\"}" $B/api/quizzes/item; }
kput() { curl -s -b "$LKJ" -X PUT -H 'Content-Type: application/json' -d "$2" $B/api/quizzes/attempts/$1; }
check "the lesson never carries the quiz questions" "$(curl -s -b "$LKJ" "$B/api/lessons/$(M "SELECT id FROM CurriculumSession WHERE editionId='$E6' AND number=1")?g=$LG" | jq_ "[('questions' in b['data'], b['data']['questionCount']) for b in d['data']['blocks'] if b['id']=='$QZ'][0]")" "(False, 6)"
kstart $QZ >/dev/null
A1=$(kq $QZ | jq_ "d['data']['active']['id']")
check "a try started: questions without correct answers, deadline from the server" "$(kq $QZ | jq_ "(len(d['data']['active']['questions']), any('correct' in q or 'pairs' in q for q in d['data']['active']['questions']), d['data']['active']['deadlineAt'] is not None)")" "(6, False, True)"
check "answers saved while working" "$(kput $A1 '{"answers":{"q1":"0\n2\n4"},"submit":false}' | jq_ "d['data']['status']")" "IN_PROGRESS"
check "handed in: graded on the server (9 / 11)" "$(kput $A1 '{"answers":{"q1":"0\n2\n4","q2":2,"q3":["range","x"],"q4":["a","b","c"],"q5":{"m1":"m1","m2":"m1"},"q6":"true"},"submit":true}' | jq_ "(d['data']['status'], float(d['data']['score']))")" "('GRADED', 9.0)"
check "correct answers shown after handing in (quiz setting)" "$(kq $QZ | jq_ "('range' in d['data']['attempts'][0]['key']['q3'], 'print' in d['data']['attempts'][0]['key']['q3'])")" "(True, True)"
check "a finished try cannot be changed" "$(kput $A1 '{"answers":{},"submit":true}' | jq_ "d['error']['code']")" "LOCKED"
kstart $QZ >/dev/null; A2=$(kq $QZ | jq_ "d['data']['active']['id']"); kput $A2 '{"answers":{},"submit":true}' >/dev/null
check "2 tries used → no third; the best try counts (9 / 11)" "$(kstart $QZ | jq_ "d['error']['code']")/$(kq $QZ | jq_ "float(d['data']['result']['score'])")" "NO_ATTEMPTS/9.0"
kstart $QB >/dev/null; AB=$(kq $QB | jq_ "d['data']['active']['id']")
check "bank quiz drew 2 random questions from the bank" "$(M "SELECT JSON_LENGTH(questions) FROM QuizAttempt WHERE id='$AB'")/$(M "SELECT JSON_UNQUOTE(JSON_EXTRACT(questions,'\$[0].id')) LIKE 'bank_%' FROM QuizAttempt WHERE id='$AB'")" "2/1"
M "UPDATE QuizAttempt SET deadlineAt=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 MINUTE) WHERE id='$AB'"
check "time is up on the server: late answers refused, the try was handed in automatically" "$(kput $AB '{"answers":{},"submit":false}' | jq_ "d['error']['code']")/$(M "SELECT status FROM QuizAttempt WHERE id='$AB'")" "TIME_UP/GRADED"
check "final exam waits for the instructor to open it" "$(kstart $QF | jq_ "d['error']['code']")" "NOT_OPEN"
check "secretary does not see the group's quizzes" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/groups/$LG/quizzes)" "403"
curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d "{\"blockId\":\"$QF\",\"open\":true}" $B/api/groups/$LG/quizzes >/dev/null
kstart $QF >/dev/null; AF=$(kq $QF | jq_ "d['data']['active']['id']")
check "instructor opened it → the student takes it; written code waits for review" "$(kput $AF '{"answers":{"w1":{"code":"def add(a,b): return a+b\nprint(add(1,2))","results":[{"id":"t1","passed":true}]},"s1":"o1"},"submit":true}' | jq_ "d['data']['status']")" "SUBMITTED"
check "instructor sees it in the review list" "$(curl -s -b "$TJ" $B/api/groups/$LG/quizzes | jq_ "[r['reviewId'] is not None for q in d['data']['quizzes'] if q['blockId']=='$QF' for r in q['results'] if r['studentId']=='$LK'][0]")" "True"
check "review needs points for every written-code answer" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"points":{}}' $B/api/quizzes/review/$AF | jq_ "d['success']")" "False"
check "instructor gives 3 / 4 for the code → final 4 / 5" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"points":{"w1":3},"feedback":"Good"}' $B/api/quizzes/review/$AF | jq_ "float(d['data']['score'])")" "4.0"
check "paper exam result typed in for another student" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"blockId\":\"$QF\",\"studentId\":\"$LO\",\"score\":70,\"maxScore\":100}" $B/api/groups/$LG/quizzes/paper | jq_ "d['success']")/$(M "SELECT CONCAT(paper,'/',status,'/',CAST(score AS SIGNED)) FROM QuizAttempt WHERE blockId='$QF' AND studentId='$LO'")" "True/1/GRADED/70"
check "a scan from outside the group's folder is refused" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"blockId\":\"$QF\",\"studentId\":\"$LO\",\"score\":70,\"maxScore\":100,\"scanFiles\":[{\"publicId\":\"x/other/scan\",\"resourceType\":\"image\"}]}" $B/api/groups/$LG/quizzes/paper | jq_ "d['success']")" "False"
check "parent sees the quiz scores" "$(curl -s -b "$LPJ" "$B/api/quizzes/my?s=$LK" | jq_ "sorted(float(i['result']['percent']) for g in d['data']['groups'] for i in g['items'] if i['result'])")" "[0.0, 80.0, 81.82]"
check "parent cannot take the quiz" "$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"blockId\":\"$QZ\"}" $B/api/quizzes/item | jq_ "d['success']")" "False"
check "item analysis for the instructor (6 questions)" "$(curl -s -b "$TJ" "$B/api/quizzes/analysis?b=$QZ&g=$LG" | jq_ "len(d['data'])")" "6"
check "level result: task 40.91% (session quizzes) and MCQ 80% (final exam) from the LMS" "$(api GET "/api/level-results?classSectionId=$LG&subjectId=$SUBJ" | jq_ "[(float(r['lms']['task']), float(r['lms']['mcq'])) for r in d['data']['rows'] if r['student']['id']=='$LK'][0]")" "(40.91, 80.0)"
api PUT /api/platform/settings '{"modules":{"lms":false}}' >/dev/null

echo "== 35. LMS analytics: numbers, groups table, follow-up list, filters, who can see it"
AN=$(api GET /api/lms/analytics)
check "admin: the LMS group is in the groups table" "$(echo "$AN" | jq_ "any(g['id']=='$LG' for g in d['data']['groups'])")" "True"
check "quiz average of the group = (81.82 + 0 + 80 + 70) / 4" "$(echo "$AN" | jq_ "[float(g['quizAvg']) for g in d['data']['groups'] if g['id']=='$LG'][0]")" "58.0"
check "the quiz tries of this week are in the weekly chart" "$(echo "$AN" | jq_ "sum(w['quizzes'] for w in d['data']['weeks']) >= 5")" "True"
check "filter by another level → no groups" "$(api GET "/api/lms/analytics?levelId=nope" | jq_ "len(d['data']['groups'])")" "0"
check "wrong period refused" "$(api GET "/api/lms/analytics?from=2026-10-10&to=2026-10-01" | jq_ "d['success']")" "False"
check "instructor sees own groups only, no instructor filter" "$(curl -s -b "$TJ" $B/api/lms/analytics | jq_ "(any(g['id']=='$LG' for g in d['data']['groups']), d['data']['options']['teachers'])")" "(True, [])"
check "secretary cannot open the analytics" "$(secapi GET /api/lms/analytics | jq_ "d['success']")" "False"
check "parent cannot open the analytics" "$(curl -s -o /dev/null -w '%{http_code}' -b "$LPJ" $B/api/lms/analytics)" "403"

echo "== 36. R1 session reports: made from attendance, instructor extras, send now / automatic, who sees what"
check "secretary cannot change the session report settings" "$(secapi PUT /api/session-reports/settings '{"enabled":true,"mode":"AUTO","hours":3,"phrases":[]}' | jq_ "d['success']")" "False"
check "admin switches session reports on (3 hours after the session)" "$(api PUT /api/session-reports/settings '{"enabled":true,"mode":"AUTO","hours":3,"phrases":[{"id":"focus","en":"Needs more focus","ar":""},{"id":"great","en":"Great work","ar":""}]}' | jq_ "d['success']")" "True"
LKE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LK' AND classSectionId='$LG'")
LOE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LO' AND classSectionId='$LG'")
D1=$(D -1); DT=$(D 0)
sess $LG "$DT" "$(rec $LKE PRESENT),$(rec $LOE ABSENT)" >/dev/null
RT=$(M "SELECT id FROM SessionReport WHERE classSectionId='$LG' AND sessionDate='$DT'")
check "saving attendance made today's report: draft, goes out by itself later" "$(M "SELECT CONCAT(status,'/',sendAt > UTC_TIMESTAMP(3)) FROM SessionReport WHERE id='$RT'")" "DRAFT/1"
P1=$(curl -s -b "$TJ" "$B/api/session-reports?groupId=$LG&date=$D1")
R1=$(echo "$P1" | jq_ "d['data']['report']['id']")
check "instructor opens an older session: its report is made on the fly (session 1, the student who attended)" "$(echo "$P1" | jq_ "(d['data']['report']['sessionNumber'], [s['name'] for s in d['data']['students']], d['data']['canEdit'])")" "(1, ['LessonKid E2e'], True)"
V1=$(api GET "/api/session-reports/$R1?student=$LK")
check "report: what was done + attendance + the session quizzes (live results)" "$(echo "$V1" | jq_ "(d['data']['lesson'] is not None, d['data']['attendance'], sorted(float(q['percent']) for q in d['data']['quizzes'] if q['percent'] is not None))")" "(True, 'PRESENT', [0.0, 80.0, 81.82])"
check "instructor adds a star, phrases (unknown ones dropped), a comment and a group note" "$(curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d "{\"groupNote\":\"We built a line robot\",\"students\":[{\"studentId\":\"$LK\",\"star\":true,\"phrases\":[\"focus\",\"nope\"],\"comment\":\"Well done\"}]}" $B/api/session-reports/$R1 | jq_ "d['success']")/$(api GET "/api/session-reports/$R1?student=$LK" | jq_ "(d['data']['star'], [p['en'] for p in d['data']['phrases']], d['data']['comment'], d['data']['groupNote'])")" "True/(True, ['Needs more focus'], 'Well done', 'We built a line robot')"
check "secretary sees the reports of the branch but cannot change them" "$(secapi GET "/api/session-reports?from=$D1&to=$DT" | jq_ "any(r['id']=='$R1' for r in d['data']['reports'])")/$(secapi PATCH /api/session-reports/$R1 '{"groupNote":"x"}' | jq_ "d['success']")" "True/False"
check "parent cannot see the report before it is sent" "$(curl -s -b "$LPJ" "$B/api/session-reports/$R1?student=$LK" | jq_ "d['success']")/$(curl -s -b "$LPJ" $B/api/students/$LK/session-reports | jq_ "len(d['data'])")" "False/0"
check "instructor presses Send now; sending twice or editing afterwards is refused" "$(curl -s -b "$TJ" -X POST $B/api/session-reports/$R1/send | jq_ "d['success']")/$(curl -s -b "$TJ" -X POST $B/api/session-reports/$R1/send | jq_ "d['success']")/$(curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"groupNote":"late edit"}' $B/api/session-reports/$R1 | jq_ "d['success']")" "True/False/False"
check "parent now sees it (with the star) and got a notification" "$(curl -s -b "$LPJ" "$B/api/session-reports/$R1?student=$LK" | jq_ "(d['data']['status'], d['data']['star'])")/$(M "SELECT COUNT(*) > 0 FROM Notification WHERE type='SESSION_REPORT' AND relatedId='$R1'")" "('SENT', True)/1"
check "parent's report list shows the sent report only" "$(curl -s -b "$LPJ" $B/api/students/$LK/session-reports | jq_ "[r['id'] for r in d['data']]==['$R1']")" "True"
check "the absent student's report says absent" "$(api GET "/api/session-reports/$RT?student=$LO" | jq_ "d['data']['attendance']")" "ABSENT"
check "a parent cannot open another family's report" "$(curl -s -b "$LPJ" "$B/api/session-reports/$RT?student=$LO" | jq_ "d['success']")" "False"
M "UPDATE SessionReport SET sendAt=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE) WHERE id='$RT'"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "time came: today's report went out by itself" "$(M "SELECT CONCAT(status,'/',sentById IS NULL) FROM SessionReport WHERE id='$RT'")" "SENT/1"
api PUT /api/session-reports/settings '{"enabled":false,"mode":"AUTO","hours":3,"phrases":[{"id":"focus","en":"Needs more focus","ar":""}]}' >/dev/null
sess $LG "$(D -2)" "$(rec $LKE PRESENT)" >/dev/null
check "switched off: no new reports" "$(M "SELECT COUNT(*) FROM SessionReport WHERE classSectionId='$LG' AND sessionDate='$(D -2)'")" "0"
check "a parent cannot open the staff list" "$(curl -s -o /dev/null -w '%{http_code}' -b "$LPJ" $B/api/session-reports)" "403"

echo "== 37. R2: skills chart, LMS part of the monthly / level report, book the next level, instructor performance"
SK1=$(api POST /api/curriculum/skills "{\"subjectId\":\"$SUBJ\",\"nameEn\":\"Loops\",\"nameAr\":\"\"}" | jq_ "d['data']['id']")
SK2=$(api POST /api/curriculum/skills "{\"subjectId\":\"$SUBJ\",\"nameEn\":\"Debugging\",\"nameAr\":\"\"}" | jq_ "d['data']['id']")
M "UPDATE CurriculumSession SET skillIds=JSON_ARRAY('$SK1') WHERE id='$S61'"
LR=$(api GET "/api/students/$LK/reports?kind=LEVEL&group=$LG")
check "level report: skills chart from the quizzes of the lesson tagged 'Loops' (9/11 + 0/2 + 4/5 = 72%), Debugging not measured" "$(echo "$LR" | jq_ "[(s['nameEn'], s['percent']) for s in d['data']['lms']['skills']['scores'] if s['nameEn'] in ('Loops','Debugging')]")" "[('Loops', 72), ('Debugging', None)]"
MR=$(api GET "/api/students/$LK/reports?kind=MONTHLY&group=$LG")
check "monthly report: stars, the instructor's comment and most used phrase from the session reports" "$(echo "$MR" | jq_ "(d['data']['lms']['stars'], d['data']['lms']['quote']['text'], d['data']['lms']['topPhrase']['en'])")" "(1, 'Well done', 'Needs more focus')"
check "staff cannot book the next level for the parent" "$(api POST /api/students/$LK/next-level "{\"group\":\"$LG\"}" | jq_ "d['success']")" "False"
check "parent books the next level → the renewal answer becomes YES (a wish, no seat)" "$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d "{\"group\":\"$LG\"}" $B/api/students/$LK/next-level | jq_ "d['data']['via']")/$(M "SELECT status FROM RenewalRequest WHERE classSectionId='$LG' AND studentId='$LK'")/$(M "SELECT COUNT(*) > 0 FROM Notification WHERE type='NEXT_LEVEL_WISH' AND relatedId='$LG'")" "RENEWAL/YES/1"
check "instructor cannot see the performance page while the setting is off" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ" $B/api/teachers/performance)" "403"
check "admin sees the instructors table (the LMS group's instructor is in it)" "$(api GET /api/teachers/performance | jq_ "any(r['teacher']['id']=='$CALT' for r in d['data']['rows'])")" "True"
api PUT /api/teachers/performance/settings '{"teacherCanSee":true}' >/dev/null
check "setting on: the instructor sees only his own page (2 session reports sent)" "$(curl -s -b "$TJ" $B/api/teachers/performance | jq_ "(d['data']['own'], len(d['data']['rows']), d['data']['rows'][0]['teacher']['id']=='$CALT', d['data']['rows'][0]['reports']['sent'])")" "(True, 1, True, 2)"
check "secretary cannot open instructor performance" "$(secapi GET /api/teachers/performance | jq_ "d['success']")" "False"
api PUT /api/teachers/performance/settings '{"teacherCanSee":false}' >/dev/null

echo "== 38. L5: tools in lessons (+ admin sites), H5P activities (player, token, results, task score, report), online class link + Join"
E7=$(api POST /api/curriculum/levels/$CL "{\"copyFromId\":\"$E6\"}" | jq_ "d['data']['id']")
S71=$(M "SELECT id FROM CurriculumSession WHERE editionId='$E7' AND number=1")
TB=$(api POST /api/curriculum/sessions/$S71/blocks '{"type":"TOOL","data":{"url":"https://scratch.mit.edu/projects/10128407","instructionsEn":"Make the cat dance"}}' | jq_ "d['data']['id']")
check "Scratch tool saved: opens inside the lesson with the Scratch player link" "$(M "SELECT CONCAT(JSON_UNQUOTE(JSON_EXTRACT(data,'\$.mode')),' ',JSON_UNQUOTE(JSON_EXTRACT(data,'\$.embedUrl'))) FROM CurriculumBlock WHERE id='$TB'")" "INLINE https://scratch.mit.edu/projects/10128407/embed"
check "a site that is not in the tools list is refused" "$(api POST /api/curriculum/sessions/$S71/blocks '{"type":"TOOL","data":{"url":"https://random-site.example/x"}}' | jq_ "d['success']")" "False"
check "secretary cannot change the tools list" "$(secapi PUT /api/lms/tools '{"extra":[]}' | jq_ "d['success']")" "False"
check "admin adds a site (address cleaned)" "$(api PUT /api/lms/tools '{"extra":[{"host":"https://www.random-site.example/page","nameEn":"Random lab","nameAr":"","mode":"NEW_TAB"}]}' | jq_ "d['data']['extra'][0]['host']")" "random-site.example"
check "now that site works as a new-tab tool" "$(api POST /api/curriculum/sessions/$S71/blocks '{"type":"TOOL","data":{"url":"https://random-site.example/x"}}' | jq_ "d['success']")/$(M "SELECT JSON_UNQUOTE(JSON_EXTRACT(data,'\$.mode')) FROM CurriculumBlock WHERE sessionId='$S71' AND type='TOOL' ORDER BY createdAt DESC, id DESC LIMIT 1")" "True/NEW_TAB"
check "an H5P item without its .h5p file is refused" "$(api POST /api/curriculum/sessions/$S71/blocks '{"type":"H5P","data":{"height":600}}' | jq_ "d['success']")" "False"
api PUT /api/platform/settings '{"modules":{"lms":true}}' >/dev/null
HB=$(M "SELECT REPLACE(UUID(),'-','')")
M "INSERT INTO CurriculumBlock (id, sessionId, \`order\`, type, audience, titleEn, data, createdAt, updatedAt) VALUES ('$HB', '$S61', 99, 'H5P', 'BOTH', 'Robot parts drag and drop', JSON_OBJECT('media', JSON_OBJECT('publicId','e2e/act','resourceType','raw'), 'height', 640), NOW(3), NOW(3))"
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LKJ=$(mktemp); login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ" 10.0.1.81
PLAY=$(curl -s -b "$LKJ" "$B/api/h5p/$HB/play?g=$LG")
check "student opens the activity player (signed file link, never the package link)" "$(echo "$PLAY" | grep -c "h5pJsonPath")/$(echo "$PLAY" | grep -c "e2e/act")" "1/0"
check "the lesson sends no package link for the H5P item" "$(curl -s -b "$LKJ" "$B/api/lessons/$S61?g=$LG" | jq_ "[b['data'] for b in d['data']['blocks'] if b['id']=='$HB'][0]")" "{'height': 640}"
check "a forged / missing file token is refused" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/h5p/$HB/f/abc.123.xyz/h5p.json")" "403"
check "parent cannot play it" "$(curl -s -o /dev/null -w '%{http_code}' -b "$LPJ" "$B/api/h5p/$HB/play?g=$LG")" "403"
hres() { curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"blockId\":\"$HB\",\"score\":$1,\"maxScore\":10,\"completed\":true}" $B/api/h5p/result | jq_ "d['success']"; }
check "student result saved (8/10, done) → the lesson item is ticked" "$(hres 8)/$(M "SELECT CONCAT(CAST(score AS SIGNED),'/',completed) FROM H5PResult WHERE blockId='$HB' AND studentId='$LK'")/$(M "SELECT COUNT(*) FROM LessonProgress WHERE blockId='$HB' AND studentId='$LK'")" "True/8/1/1"
check "a lower try keeps the best score; tries counted" "$(hres 5)/$(M "SELECT CONCAT(CAST(score AS SIGNED),'/',attempts) FROM H5PResult WHERE blockId='$HB' AND studentId='$LK'")" "True/8/2"
check "staff cannot save a result" "$(api POST /api/h5p/result "{\"groupId\":\"$LG\",\"blockId\":\"$HB\",\"score\":10,\"maxScore\":10}" | jq_ "d['success']")" "False"
check "instructor sees the activity results (80%)" "$(curl -s -b "$TJ" $B/api/groups/$LG/h5p | jq_ "[float(r['percent']) for a in d['data']['activities'] if a['blockId']=='$HB' for r in a['results']]")" "[80.0]"
check "level result: task now counts the activity too ((81.82 + 0 + 80) / 3)" "$(api GET "/api/level-results?classSectionId=$LG&subjectId=$SUBJ" | jq_ "[float(r['lms']['task']) for r in d['data']['rows'] if r['student']['id']=='$LK'][0]")" "53.94"
check "session report shows the activity result" "$(api GET "/api/session-reports/$R1?student=$LK" | jq_ "[a['percent'] for a in d['data']['activities']]")" "[80]"
check "online link: http refused, https saved" "$(curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"url":"http://zoom.us/j/1"}' $B/api/groups/$LG/online | jq_ "d['success']")/$(curl -s -b "$TJ" -X PATCH -H 'Content-Type: application/json' -d '{"url":"https://zoom.us/j/123456"}' $B/api/groups/$LG/online | jq_ "d['data']['url']")" "False/https://zoom.us/j/123456"
check "secretary does not see / change the online link" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/groups/$LG/online)" "403"
NOWC=$(node -e "const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());const g=t=>p.find(x=>x.type===t).value;console.log(['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(g('weekday'))+' '+g('hour')+':'+g('minute'))")
M "UPDATE ClassSection SET scheduleSlots=JSON_ARRAY(JSON_OBJECT('dayOfWeek', ${NOWC%% *}, 'time', '${NOWC##* }')) WHERE id='$LG'"
check "student sees today's online class with Join open" "$(curl -s -b "$LKJ" $B/api/online/my | jq_ "[(r['groupId']=='$LG', r['canJoin']) for r in d['data']]")" "[(True, True)]"
check "Join gives the meeting link and is logged (provisional attendance)" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\"}" $B/api/online/join | jq_ "d['data']['url']")/$(M "SELECT COUNT(*) FROM OnlineJoin WHERE classSectionId='$LG' AND studentId='$LK'")" "https://zoom.us/j/123456/1"
check "the attendance screen shows who joined online" "$(api GET "/api/enrollment-attendance/roster?classSectionId=$LG&date=$(D 0)" | jq_ "[e['onlineJoinedAt'] is not None for e in d['data']['enrollments'] if e['student']['id']=='$LK'][0]")" "True"
check "the parent can press Join for the child; not for another family" "$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"s\":\"$LK\"}" $B/api/online/join | jq_ "d['success']")/$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$LG\",\"s\":\"$LO\"}" $B/api/online/join | jq_ "d['success']")" "True/False"
api PUT /api/platform/settings '{"modules":{"lms":false}}' >/dev/null
rm -f "$LKJ"

echo "== 39. P1 passport: number, automatic / manual / event stamps, track graduation, share link, printing, who sees what"
PV=$(api GET /api/passport/$LK)
check "passport number TN-PASS-<join year>-NNNN, welcome stamp, ready-made stamps created" "$(echo "$PV" | jq_ "(__import__('re').match(r'^TN-PASS-\d{4}-\d{4}$', d['data']['passport']['number']) is not None, any(s['nameEn']=='Welcome to TechNova' for s in d['data']['stamps']))")/$(M "SELECT COUNT(*) >= 24 FROM PassportStamp WHERE code IS NOT NULL")" "(True, True)/1"
PN=$(mkstu PassNew 01066660131 Hala 01066660132)
check "a student's first check is silent (welcome stamp, no notification)" "$(api GET /api/passport/$PN | jq_ "len(d['data']['stamps'])")/$(M "SELECT COUNT(*) FROM Notification WHERE type='PASSPORT_STAMP' AND relatedId='$PN'")" "1/0"
check "secretary cannot add stamps to the library" "$(secapi POST /api/passport/stamps '{"nameEn":"X","kind":"MANUAL","givers":["TEACHER"]}' | jq_ "d['success']")" "False"
check "admin adds an automatic stamp (2 sessions)" "$(api POST /api/passport/stamps '{"nameEn":"Two sessions","nameAr":"","kind":"AUTO","rule":"SESSIONS","threshold":2,"icon":"2","color":"#123456"}' | jq_ "d['success']")" "True"
check "the next check gives it and notifies the family" "$(api GET /api/passport/$LK | jq_ "any(s['nameEn']=='Two sessions' for s in d['data']['stamps'])")/$(M "SELECT COUNT(*) > 0 FROM Notification WHERE type='PASSPORT_STAMP' AND relatedId='$LK'")" "True/1"
check "instructor gives a by-hand stamp to his student" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"stampId\":\"$(M "SELECT id FROM PassportStamp WHERE code='FIRST_ROBOT'")\",\"studentIds\":[\"$LK\"],\"note\":\"Line follower\"}" $B/api/passport/stamps/give | jq_ "d['data']['given']")" "1"
check "secretary is not one of that stamp's givers" "$(secapi POST /api/passport/stamps/give "{\"stampId\":\"$(M "SELECT id FROM PassportStamp WHERE code='FIRST_ROBOT'")\",\"studentIds\":[\"$LK\"]}" | jq_ "d['success']")" "False"
LKCARD=$(M "SELECT idCardQRCode FROM Student WHERE id='$LK'")
COMP=$(M "SELECT id FROM PassportStamp WHERE code='COMPETITION'")
check "event stamp by scanning the card (secretary); second scan = already has it; a wrong code is refused" "$(secapi POST /api/passport/stamps/$COMP/scan "{\"code\":\"$LKCARD\"}" | jq_ "d['data']['already']")/$(secapi POST /api/passport/stamps/$COMP/scan "{\"code\":\"$LKCARD\"}" | jq_ "d['data']['already']")/$(secapi POST /api/passport/stamps/$COMP/scan '{"code":"TN/2026/0001"}' | jq_ "d['success']")" "False/True/False"
api POST /api/passport/stamps '{"nameEn":"Secret helper","nameAr":"","kind":"MANUAL","givers":["TEACHER"],"secret":true}' >/dev/null
check "secret stamps are hidden from the instructor's list" "$(curl -s -b "$TJ" $B/api/passport/stamps | jq_ "any(s['nameEn']=='Secret helper' for s in d['data'])")" "False"
PS=$LK; PSL=$CL; PSC=$SUBJ
TRK=$(M "SELECT trackId FROM AcademicSubject WHERE id='$PSC'"); [ -z "$TRK" -o "$TRK" = "NULL" ] && { TRK=$(M "SELECT id FROM Track LIMIT 1"); M "UPDATE AcademicSubject SET trackId='$TRK' WHERE id='$PSC'"; }
M "UPDATE Level SET \`order\`=999 WHERE id='$PSL'"
api PUT /api/passport/settings "{\"trackRequired\":{\"$TRK\":[\"$PSC\"]},\"trackColors\":{\"$TRK\":\"#ff6600\"},\"shareDays\":30,\"bookletPrice\":50,\"companyStampUrl\":null,\"signatureUrl\":null,\"signatureName\":\"Manager\"}" >/dev/null
M "UPDATE ClassSection SET currentCycleNumber=99 WHERE id='$LG'"
api POST /api/level-results "{\"studentEnrollmentId\":\"$LKE\",\"subjectId\":\"$SUBJ\",\"homeworkScore\":95,\"taskScore\":95,\"instructorScore\":95,\"projectScore\":95,\"mcqScore\":95,\"instructorFeedback\":\"Great level\"}" >/dev/null
PP=$(api GET /api/passport/$PS)
check "finished level → level stamp in the track colour; track needs only that course → gold graduation stamp" "$(echo "$PP" | jq_ "(any(s['nameEn']=='Level completed' and s['color']=='#ff6600' for s in d['data']['stamps']), any(s['nameEn']=='Track graduate' for s in d['data']['stamps']))")" "(True, True)"
check "graduation certificate made with the TN-CERT numbering" "$(M "SELECT certificateNumber LIKE 'TN-CERT-%' FROM Certificate WHERE studentId='$PS' AND remarks='TRACK_GRADUATION:$TRK'")" "1"
check "settings: secretary cannot change them; an image from another site is refused" "$(secapi PUT /api/passport/settings '{"shareDays":5}' | jq_ "d['success']")/$(api PUT /api/passport/settings '{"companyStampUrl":"https://evil.example/stamp.png"}' | jq_ "d['success']")" "False/False"
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LKJ=$(mktemp); login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ" 10.0.1.91
check "student opens his passport: new stamps are marked as seen (stamp animation once)" "$(curl -s -b "$LKJ" $B/api/passport/$LK | jq_ "(d['data']['viewer'], any(s['isNew'] for s in d['data']['stamps']))")/$(M "SELECT COUNT(*) FROM StudentStamp WHERE studentId='$LK' AND seenAt IS NULL")" "('STUDENT', True)/0"
check "a student cannot open another student's passport" "$(curl -s -o /dev/null -w '%{http_code}' -b "$LKJ" $B/api/passport/$LO)" "403"
check "the student cannot make a share link; staff cannot either" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d '{}' $B/api/passport/$LK/share | jq_ "d['success']")/$(api POST /api/passport/$LK/share '{}' | jq_ "d['success']")" "False/False"
SH=$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d '{"showProjects":false,"showPhoto":false}' $B/api/passport/$LK/share)
TOK=$(echo "$SH" | jq_ "d['data']['token']")
PUB=$(curl -s $B/api/passport/public/$TOK)
check "parent's share link works without sign-in and shows no phone / money / grades / attendance / photo" "$(echo "$PUB" | jq_ "(d['data']['name'], d['data']['photo'], sorted(d['data'].keys()))")" "('LessonKid E2e', None, ['campus', 'certificates', 'expiresAt', 'joinedAt', 'name', 'number', 'photo', 'projects', 'skills', 'stamps'])"
SHID=$(M "SELECT id FROM PassportShare WHERE token='$TOK'")
check "the parent stops the link → it shows nothing" "$(curl -s -b "$LPJ" -X DELETE $B/api/passport/shares/$SHID | jq_ "d['success']")/$(curl -s -o /dev/null -w '%{http_code}' $B/api/passport/public/$TOK)" "True/404"
check "printing: instructor no; secretary yes with copy numbers (2 = replacement) and the booklet price" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"kind":"BOOKLET"}' $B/api/passport/$LK/prints | jq_ "d['success']")/$(secapi POST /api/passport/$LK/prints '{"kind":"BOOKLET"}' | jq_ "d['data']['copyNo']")/$(secapi POST /api/passport/$LK/prints '{"kind":"BOOKLET"}' | jq_ "(d['data']['copyNo'], d['data']['price'])")" "False/1/(2, 50)"
check "parents and students cannot open the print data" "$(curl -s -o /dev/null -w '%{http_code}' -b "$LPJ" $B/api/passport/$LK/print)/$(curl -s -o /dev/null -w '%{http_code}' -b "$LKJ" $B/api/passport/$LK/print)" "403/403"
check "transcript data for staff has the results" "$(secapi GET /api/passport/$PS/print | jq_ "len(d['data']['transcript']) > 0")" "True"
rm -f "$LKJ"

echo "== 40. P2 profile: map, goals, diary (older students), thank-you notes + approval, album, experience, uploads check, interest, recap, portfolio, share skills"
PRF=$(api GET /api/profile/$LK)
check "profile: the TechNova map with islands, a 10-year-old is not an 'older student'" "$(echo "$PRF" | jq_ "(len(d['data']['map']['islands']) > 0, d['data']['age'], d['data']['older'])")" "(True, 10, False)"
check "parent adds a system goal (1 stamp)" "$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d '{"action":"goal","title":"Get one more stamp","kind":"SYSTEM","metric":"STAMPS","target":1}' $B/api/profile/$LK | jq_ "d['success']")" "True"
curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"stampId\":\"$(M "SELECT id FROM PassportStamp WHERE code='HELPER'")\",\"studentIds\":[\"$LK\"]}" $B/api/passport/stamps/give >/dev/null
check "the instructor's stamp moves the goal to done (counted by the system)" "$(api GET /api/profile/$LK | jq_ "[(g['value'], g['target'], g['done']) for g in d['data']['goals'] if g['title']=='Get one more stamp'][0]")" "(1, 1, True)"
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LKJ=$(mktemp); login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LKJ" 10.0.1.95
check "student adds his own goal and moves the bar to 100%" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d '{"action":"goal","title":"Dancing robot","kind":"FREE"}' $B/api/profile/$LK | jq_ "d['success']")/$(curl -s -b "$LKJ" -X PATCH -H 'Content-Type: application/json' -d "{\"type\":\"goal\",\"id\":\"$(M "SELECT id FROM StudentGoal WHERE studentId='$LK' AND title='Dancing robot'")\",\"progress\":100}" $B/api/profile/items | jq_ "d['success']")/$(M "SELECT doneAt IS NOT NULL FROM StudentGoal WHERE studentId='$LK' AND title='Dancing robot'")" "True/True/1"
check "the diary is for older students (default from 12)" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d '{"action":"diary","text":"Today I learned loops"}' $B/api/profile/$LK | jq_ "d['success']")" "False"
api PUT /api/profile/settings '{"olderAge":8,"maxVideoSeconds":60,"maxUploadMb":50,"parentPortfolio":false,"thanksOn":true,"diaryOn":true,"uploadsOn":true}' >/dev/null
check "age limit lowered to 8 in the settings → the diary works" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d '{"action":"diary","text":"Today I learned loops"}' $B/api/profile/$LK | jq_ "d['success']")/$(api GET /api/profile/$LK | jq_ "[x['text'] for x in d['data']['diary']]")" "True/['Today I learned loops']"
check "a thank-you note only to a classmate" "$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d "{\"action\":\"thanks\",\"toStudentId\":\"$PN\",\"text\":\"Thanks\"}" $B/api/profile/$LK | jq_ "d['success']")/$(curl -s -b "$LKJ" -X POST -H 'Content-Type: application/json' -d "{\"action\":\"thanks\",\"toStudentId\":\"$LO\",\"text\":\"Thanks for helping with the motor\"}" $B/api/profile/$LK | jq_ "d['success']")" "False/True"
check "the note waits for the instructor (not shown yet)" "$(api GET /api/profile/$LO | jq_ "len(d['data']['thanks'])")/$(curl -s -b "$TJ" $B/api/profile/approvals | jq_ "len(d['data']['thanks'])")" "0/1"
TN=$(M "SELECT id FROM ThankNote WHERE fromStudentId='$LK' AND toStudentId='$LO'")
check "instructor approves → shown with the first name only" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"what\":\"THANKS\",\"id\":\"$TN\",\"approve\":true}" $B/api/profile/approvals | jq_ "d['success']")/$(api GET /api/profile/$LO | jq_ "[(t['from'], t['text']) for t in d['data']['thanks']]")" "True/[('LessonKid', 'Thanks for helping with the motor')]"
check "instructor adds an album moment; a parent cannot" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"action":"moment","title":"First robot that moved"}' $B/api/profile/$LK | jq_ "d['success']")/$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d '{"action":"moment","title":"x"}' $B/api/profile/$LK | jq_ "d['success']")" "True/False"
check "managers record experience; an instructor cannot" "$(api POST /api/profile/$LK '{"action":"experience","role":"ASSISTANT","titleEn":"Helped in Scratch L1","from":"2026-09-01"}' | jq_ "d['success']")/$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"action":"experience","role":"OTHER","from":"2026-09-01"}' $B/api/profile/$LK | jq_ "d['success']")" "True/False"
check "an upload from outside the student's private folder is refused" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d '{"action":"upload","title":"Robot","media":{"publicId":"other/folder/x","resourceType":"image"}}' $B/api/profile/$LK | jq_ "d['success']")" "False"
check "parent books the map's next level → waiting list" "$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d "{\"action\":\"interest\",\"levelId\":\"$CL\"}" $B/api/profile/$LK | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM WaitingListEntry WHERE studentId='$LK' AND levelId='$CL' AND status='WAITING'")" "True/1"
check "yearly recap numbers" "$(api GET "/api/profile/$LK?view=recap" | jq_ "(d['data']['sessions'] >= 3, len(d['data']['stamps']) >= 3)")" "(True, True)"
check "portfolio: staff yes; instructor and parent no (setting off)" "$(secapi GET "/api/profile/$LK?view=portfolio" | jq_ "d['success']")/$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ" "$B/api/profile/$LK?view=portfolio")/$(curl -s -o /dev/null -w '%{http_code}' -b "$LPJ" "$B/api/profile/$LK?view=portfolio")" "True/403/403"
SK=$(curl -s -b "$LPJ" -X POST -H 'Content-Type: application/json' -d '{"showSkills":true}' $B/api/passport/$LK/share | jq_ "d['data']['token']")
check "the parent can add the skills to the share link" "$(curl -s $B/api/passport/public/$SK | jq_ "[k['nameEn'] for s in d['data']['skills'] for k in s['scores']]")" "['Loops']"
check "secretary cannot change the profile settings" "$(secapi PUT /api/profile/settings '{"olderAge":5,"maxVideoSeconds":60,"maxUploadMb":50,"parentPortfolio":true,"thanksOn":true,"diaryOn":true,"uploadsOn":true}' | jq_ "d['success']")" "False"
rm -f "$LKJ"

echo "== 41. M0 places: staff see only their places, single groups, extra places, header filter, instructor picker, pay per place, trainee"
SECU=$(M "SELECT id FROM User WHERE email='sec@e2e.local'")
PB=$(api POST /api/campuses '{"name":"E2E Partner Place","code":"EPP","address":"5 Sheraton Rd Hurghada","phone":"+201000000001","email":"epp@e2e.local","principalName":"Partner Head"}' | jq_ "d['data']['id']")
check "a second place is made and marked as a partner place" "$(api PATCH /api/campuses/$PB '{"kind":"PARTNER"}' | jq_ "d['success']")/$(M "SELECT kind FROM Campus WHERE id='$PB'")" "True/PARTNER"
GB=$(api POST /api/groups "{\"campusId\":\"$PB\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E Place B\",\"sectionName\":\"A\",\"levelId\":\"$CL\"}" | jq_ "d['data']['id']")
SB=$(mkstu PlaceKid 01066660141 Rana 01066660142); M "UPDATE Student SET campusId='$PB' WHERE id='$SB'"
api POST /api/groups/$GB/students "{\"studentId\":\"$SB\"}" >/dev/null
check "only Super Admin may change places of an account" "$(secapi PUT /api/users/$SECU/places '{"allLocations":true,"campusIds":[],"groupIds":[]}' | jq_ "d['success']")" "False"
api PUT /api/users/$SECU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[]}" >/dev/null
check "secretary of the main place: the other place's group and student do not appear at all" "$(secapi GET /api/groups | jq_ "any(g['id']=='$GB' for g in d['data'])")/$(secapi GET "/api/students?limit=100&search=PlaceKid" | jq_ "len(d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/groups/$GB)" "False/0/403"
api PUT /api/users/$SECU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[\"$GB\"]}" >/dev/null
check "given one group of the other place: she sees that group and its student" "$(secapi GET /api/groups | jq_ "any(g['id']=='$GB' for g in d['data'])")/$(secapi GET "/api/students?limit=100&search=PlaceKid" | jq_ "len(d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/groups/$GB)" "True/1/200"
check "a single group does not give the place: she cannot make a group there" "$(secapi POST /api/groups "{\"campusId\":\"$PB\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E Sec B\",\"sectionName\":\"A\",\"levelId\":\"$CL\"}" | jq_ "d['success']")" "False"
api PUT /api/users/$SECU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\",\"$PB\"],\"groupIds\":[]}" >/dev/null
check "given the whole other place: the header filter lists both places" "$(secapi GET /api/places/mine | jq_ "(d['data']['all'], sorted(p['kind'] for p in d['data']['places']))")" "(False, ['MAIN', 'PARTNER'])"
curl -s -b "$SECJ" -c "$SECJ" -X POST -H 'Content-Type: application/json' -d "{\"campusId\":\"$PB\"}" $B/api/places/mine >/dev/null
check "the header filter narrows every list to one place" "$(secapi GET /api/groups | jq_ "sorted(set(g['campus']['id']=='$PB' for g in d['data']))")" "[True]"
check "the header filter cannot widen (a place she does not have is refused)" "$(secapi POST /api/places/mine '{"campusId":"nope-place"}' | jq_ "d['success']")" "False"
curl -s -b "$SECJ" -c "$SECJ" -X POST -H 'Content-Type: application/json' -d '{"campusId":"ALL"}' $B/api/places/mine >/dev/null
check "instructor picker for the other place's group: only instructors of that place" "$(api GET "/api/teachers/for-selection?mode=all&classSectionId=$GB" | jq_ "any(t['id']=='$CALT' for t in d['data']['teachers'])")" "False"
api PUT /api/teachers/$CALT/places "{\"allLocations\":false,\"campusIds\":[\"$PB\"],\"pay\":[{\"campusId\":\"$PB\",\"fixed\":null,\"percent\":null,\"perSession\":200}],\"employment\":[]}" >/dev/null
check "instructor given the other place → he can be chosen there" "$(api GET "/api/teachers/for-selection?mode=all&classSectionId=$GB" | jq_ "any(t['id']=='$CALT' for t in d['data']['teachers'])")" "True"
api POST /api/groups/$GB/instructor "{\"teacherId\":\"$CALT\",\"force\":true}" >/dev/null
SBE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$SB' AND classSectionId='$GB'")
curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"classSectionId\":\"$GB\",\"attendanceDate\":\"$(D 0)\",\"records\":[$(rec $SBE PRESENT)]}" $B/api/enrollment-attendance >/dev/null
check "pay in that place uses the place rate (200 per session)" "$(api GET /api/teachers/$CALT/group-pay-summary | jq_ "[(float(g['perSessionAmount']), g['sessionsCounted']) for g in d['data']['groups'] if g['classSectionId']=='$GB'][0]")" "(200.0, 1)"
check "overlapping employment periods are refused" "$(api PUT /api/teachers/$CALT/places "{\"allLocations\":false,\"campusIds\":[\"$PB\"],\"pay\":[],\"employment\":[{\"employer\":\"TECHNOVA\",\"kind\":\"TRAINEE\",\"fromDate\":\"2026-01-01\",\"toDate\":null},{\"employer\":\"PARTNER\",\"kind\":\"TEACHER\",\"fromDate\":\"2026-06-01\",\"toDate\":null}]}" | jq_ "d['success']")" "False"
api PUT /api/teachers/$CALT/places "{\"allLocations\":false,\"campusIds\":[\"$PB\"],\"pay\":[{\"campusId\":\"$PB\",\"fixed\":null,\"percent\":null,\"perSession\":200}],\"employment\":[{\"employer\":\"TECHNOVA\",\"kind\":\"TRAINEE\",\"fromDate\":\"2026-01-01\",\"toDate\":null}]}" >/dev/null
check "a trainee is not paid (the group drops out of his pay)" "$(api GET /api/teachers/$CALT/group-pay-summary | jq_ "any(g['classSectionId']=='$GB' for g in d['data']['groups'])")" "False"
api PUT /api/teachers/$CALT/places "{\"allLocations\":false,\"campusIds\":[],\"pay\":[],\"employment\":[]}" >/dev/null
check "the instructor still sees his own group in the other place (teaching it)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ" $B/api/groups/$GB/lessons)" "200"
rm -f "$LKJ" "$LPJ" "$TJ"


echo "== 42. M0 places (finance): an accountant of one place sees only that place's invoices, payments, refunds and wallets"
ACJ=$(mktemp); login_jar $ACCE E2eAcc12345 "$ACJ" 10.0.1.96
accapi() { curl -s -b "$ACJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
INVB=$(invid $SB $GB)
if [ -z "$INVB" ]; then INVB=$(api POST /api/accountant/fees/invoices "{\"studentId\":\"$SB\",\"month\":\"October 2026\",\"academicYear\":\"2026-2027\",\"dueDate\":\"$(D 10)T00:00:00.000Z\",\"items\":[{\"description\":\"Course fee\",\"amount\":500}]}" | jq_ "d['data']['id']"); fi
M "UPDATE FeeInvoice SET classSectionId='$GB' WHERE id='$INVB'"
INVBDUE=$(M "SELECT ROUND(totalAmount-paidAmount,2) FROM FeeInvoice WHERE id='$INVB'")
api POST /api/fees/$INVB/payments "{\"amount\":$INVBDUE,\"paymentMethod\":\"Cash\"}" >/dev/null
api POST /api/wallet/topups "{\"studentId\":\"$SB\",\"amount\":50,\"method\":\"Cash\"}" >/dev/null
check "the other place's invoice exists and was paid" "$(M "SELECT paidAmount>0 FROM FeeInvoice WHERE id='$INVB'")" "1"
check "accountant of the main place: the other place's invoice is not in the list and cannot be opened" "$(accapi GET "/api/fees?limit=100&studentId=$SB" | jq_ "any(i['id']=='$INVB' for i in d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/fees/$INVB)" "False/403"
check "…cannot open the other place's student file, guardians, enrollments or timeline (live test 2026-10-24)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/students/$SB)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/students/$SB/guardians)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/students/$SB/enrollments)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/students/$SB/timeline)" "403/403/403/403"
check "…cannot take a payment on it nor make an invoice for that student" "$(accapi POST /api/accountant/fees/invoices/$INVB/payments '{"amount":10,"paymentMethod":"Cash"}' | jq_ "d['success']")/$(accapi POST /api/accountant/fees/invoices "{\"studentId\":\"$SB\",\"month\":\"October 2026\",\"academicYear\":\"2026-2027\",\"dueDate\":\"$(D 10)T00:00:00.000Z\",\"items\":[{\"description\":\"xx\",\"amount\":10}]}" | jq_ "d['success']")" "False/False"
check "…does not see that student's wallet (balance, statement, top-ups) nor can top it up" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/students/$SB/wallet)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/students/$SB/wallet/statement)/$(accapi GET "/api/wallet/topups?status=TODAY" | jq_ "any(t['student']['id']=='$SB' if isinstance(t.get('student'),dict) else t.get('studentId')=='$SB' for t in d['data']['topUps'])")/$(accapi POST /api/wallet/topups "{\"studentId\":\"$SB\",\"amount\":20,\"method\":\"Cash\"}" | jq_ "d['success']")" "403/403/False/False"
RFB=$(api POST /api/refunds "{\"invoiceId\":\"$INVB\",\"amount\":10,\"method\":\"WALLET\"}" | jq_ "d['data']['refundId']")
check "…cannot ask for a refund on the other place's invoice" "$(accapi POST /api/refunds "{\"invoiceId\":\"$INVB\",\"amount\":5,\"method\":\"WALLET\"}" | jq_ "d['success']")" "False"
check "…does not see a refund of the other place" "$(accapi GET /api/refunds | jq_ "any(r['id']=='$RFB' for r in d['data'])")/$(api GET /api/refunds | jq_ "any(r['id']=='$RFB' for r in d['data'])")" "False/True"
EXB=$(api POST /api/accountant/expenses "{\"title\":\"E2E place B rent\",\"amount\":300,\"category\":\"UTILITIES\",\"date\":\"$(D 0)\",\"campusId\":\"$PB\"}" | jq_ "d['data']['id']")
check "…does not see the other place's expense (list and open)" "$(accapi GET "/api/accountant/expenses?limit=100" | jq_ "any(e['id']=='$EXB' for e in d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/accountant/expenses/$EXB)" "False/403"
check "…cannot record an expense for the other place" "$(accapi POST /api/accountant/expenses "{\"title\":\"x\",\"amount\":5,\"category\":\"UTILITIES\",\"date\":\"$(D 0)\",\"campusId\":\"$PB\"}" | jq_ "d['success']")" "False"
ACCU=$(M "SELECT id FROM User WHERE email='$ACCE'")
api PUT /api/users/$ACCU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[\"$GB\"]}" >/dev/null
check "given the other place's group only: its invoice appears and opens, its expense still does not" "$(accapi GET "/api/fees?limit=100&studentId=$SB" | jq_ "any(i['id']=='$INVB' for i in d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/fees/$INVB)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/accountant/expenses/$EXB)" "True/200/403"
api PUT /api/users/$ACCU/places "{\"allLocations\":true,\"campusIds\":[],\"groupIds\":[]}" >/dev/null
check "given every place: the expense and refund appear too" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/accountant/expenses/$EXB)/$(accapi GET /api/refunds | jq_ "any(r['id']=='$RFB' for r in d['data'])")" "200/True"
api PUT /api/users/$ACCU/places '{"allLocations":false,"campusIds":[],"groupIds":[]}' >/dev/null
rm -f "$ACJ"
echo "== 43. M0 places (staff): instructors, accounts, salaries and leaves follow the person's places"
api PUT /api/users/$SECU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[]}" >/dev/null
CALTC=$(M "SELECT campusId FROM Teacher WHERE id='$CALT'")
M "UPDATE Teacher SET campusId='$PB' WHERE id='$CALT'"
check "secretary of the main place: an instructor of the other place is not listed and cannot be opened" "$(secapi GET "/api/teachers?limit=100" | jq_ "any(t['id']=='$CALT' for t in d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/teachers/$CALT)" "False/403"
check "…nor can she record his absence or read his week (live test 2026-10-24)" "$(secapi POST /api/teacher-absences "{\"teacherId\":\"$CALT\",\"date\":\"$(D 25)\",\"scope\":\"FULL_DAY\",\"reason\":\"e2e other place\"}" | jq_ "d['success']")/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" "$B/api/teachers/$CALT/my-week?days=3")" "False/403"
api PUT /api/teachers/$CALT/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"pay\":[],\"employment\":[]}" >/dev/null
check "the instructor also serves the main place → listed and opens" "$(secapi GET "/api/teachers?limit=100" | jq_ "any(t['id']=='$CALT' for t in d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/teachers/$CALT)" "True/200"
api PUT /api/teachers/$CALT/places '{"allLocations":false,"campusIds":[],"pay":[],"employment":[]}' >/dev/null
M "UPDATE Teacher SET campusId='$CALTC' WHERE id='$CALT'"
TCHID=$CALT
SABS=$(secapi POST /api/teacher-absences "{\"teacherId\":\"$TCHID\",\"date\":\"$(D 25)\",\"scope\":\"FULL_DAY\",\"reason\":\"called in sick (e2e)\"}")
check "the secretary records an absence for an instructor of her place (from the screen)" "$(echo "$SABS" | jq_ "d['success'] or (d.get('error') or {}).get('message')")" "True"
M "DELETE FROM TeacherAbsence WHERE id='$(echo "$SABS" | jq_ "d['data']['id']")'"
api POST /api/users/create-admin "{\"firstName\":\"Main\",\"lastName\":\"Admin\",\"email\":\"m0admin@e2e.local\",\"password\":\"E2eAdm12345\",\"role\":\"ADMIN\",\"campusId\":\"$CAMPUS\"}" >/dev/null
api POST /api/users/create-admin "{\"firstName\":\"Other\",\"lastName\":\"Sec\",\"email\":\"m0secb@e2e.local\",\"password\":\"E2eSecB12345\",\"role\":\"SECRETARY\",\"campusId\":\"$PB\"}" >/dev/null
SECB=$(M "SELECT id FROM User WHERE email='m0secb@e2e.local'")
ADJ=$(mktemp); login_jar m0admin@e2e.local E2eAdm12345 "$ADJ" 10.0.1.97
adapi() { curl -s -b "$ADJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
check "admin of the main place: the other place's account is not in the list" "$(adapi GET "/api/users?query=m0secb&limit=50" | jq_ "len(d['data'])")/$(api GET "/api/users?query=m0secb&limit=50" | jq_ "len(d['data'])")" "0/1"
check "…cannot reset its password, nor create staff in the other place" "$(adapi POST /api/users/reset-credentials "{\"userId\":\"$SECB\",\"newPassword\":\"Hacked12345\"}" | jq_ "d['success']")/$(adapi POST /api/users/create-admin "{\"firstName\":\"X\",\"lastName\":\"Y\",\"email\":\"m0x@e2e.local\",\"password\":\"E2eXyz12345\",\"role\":\"SECRETARY\",\"campusId\":\"$PB\"}" | jq_ "d['success']")" "False/False"
M "INSERT INTO LeaveRequest (id, applicantId, applicantRole, applicantName, leaveType, startDate, endDate, reason, status, createdAt, updatedAt) VALUES ('m0leaveb', '$SECB', 'SECRETARY', 'Other Sec', 'CASUAL', NOW(), NOW(), 'e2e', 'PENDING', NOW(), NOW())" 2>/dev/null
check "…does not see the other place's leave request (list and open)" "$(adapi GET "/api/leaves?limit=100" | jq_ "any(l['id']=='m0leaveb' for l in d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/leaves/m0leaveb)/$(api GET "/api/leaves?limit=100" | jq_ "any(l['id']=='m0leaveb' for l in d['data'])")" "False/403/True"
check "…cannot make a salary slip for the other place's staff" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" -X POST -H 'Content-Type: application/json' -d "{\"employeeId\":\"$SECB\",\"month\":\"October 2026\",\"salaryPeriodStart\":\"2026-10-01T00:00:00.000Z\",\"salaryPeriodEnd\":\"2026-10-31T00:00:00.000Z\",\"basicSalary\":1000}" $B/api/accountant/salary-slips)" "403"
ADU=$(M "SELECT id FROM User WHERE email='m0admin@e2e.local'")
api PUT /api/users/$ADU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\",\"$PB\"],\"groupIds\":[]}" >/dev/null
check "given the other place too: the account and the leave appear" "$(adapi GET "/api/users?query=m0secb&limit=50" | jq_ "len(d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/leaves/m0leaveb)" "1/200"
rm -f "$ADJ"
echo "== 44. M0 places (the rest): branches, holidays, contact log, excuses, reports follow the person's places"
api PUT /api/users/$ADU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[]}" >/dev/null
ADJ=$(mktemp); login_jar m0admin@e2e.local E2eAdm12345 "$ADJ" 10.0.1.98
check "admin of the main place: the branch list has only his place; the other place does not open" "$(adapi GET "/api/campuses?limit=100" | jq_ "any(c['id']=='$PB' for c in d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/campuses/$PB)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/campuses/$CAMPUS)" "False/403/200"
api POST /api/holidays "{\"date\":\"$(D 40)\",\"name\":\"E2E place B day\",\"campusId\":\"$PB\"}" >/dev/null
HB=$(M "SELECT id FROM Holiday WHERE campusId='$PB' AND name='E2E place B day' LIMIT 1")
check "…does not see / delete the other place's holiday, cannot add one there or for the whole company" "$(adapi GET /api/holidays | jq_ "any(h['id']=='$HB' for h in d['data'])")/$(adapi DELETE /api/holidays/$HB | jq_ "d['success']")/$(adapi POST /api/holidays "{\"date\":\"$(D 41)\",\"name\":\"x\",\"campusId\":\"$PB\"}" | jq_ "d['success']")/$(adapi POST /api/holidays "{\"date\":\"$(D 41)\",\"name\":\"x\"}" | jq_ "d['success']")" "False/False/False/False"
check "…can add a holiday for his own place" "$(adapi POST /api/holidays "{\"date\":\"$(D 42)\",\"name\":\"E2E main day\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['success']")" "True"
check "…cannot log a contact or an absence excuse for the other place's student" "$(adapi POST /api/contact-logs "{\"studentId\":\"$SB\",\"channel\":\"CALL\",\"reason\":\"OTHER\",\"summary\":\"e2e call\"}" | jq_ "d['success']")/$(adapi POST /api/absence-excuses "{\"studentId\":\"$SB\",\"classSectionId\":\"$GB\",\"sessionDate\":\"$(D 1)\",\"reason\":\"sick\"}" | jq_ "d['success']")" "False/False"
check "…the groups money report has only his place" "$(adapi GET /api/reports/groups-financials-summary | jq_ "any(b['campusId']=='$PB' for b in d['data']['branches'])")/$(api GET /api/reports/groups-financials-summary | jq_ "any(b['campusId']=='$PB' for b in d['data']['branches'])")" "False/True"
api PUT /api/users/$ADU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\",\"$PB\"],\"groupIds\":[]}" >/dev/null
check "given the other place too: it is listed and its holiday shows" "$(adapi GET "/api/campuses?limit=100" | jq_ "any(c['id']=='$PB' for c in d['data'])")/$(adapi GET /api/holidays | jq_ "any(h['id']=='$HB' for h in d['data'])")" "True/True"
rm -f "$ADJ"
echo "== 45. M1-a partners: partners page, places, contracts + alert, per-person / per-place permissions"
api PUT /api/users/$ADU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[]}" >/dev/null
ADJ=$(mktemp); login_jar m0admin@e2e.local E2eAdm12345 "$ADJ" 10.0.1.99
PN=$(api POST /api/partners '{"name":"E2E Nour School","kind":"SCHOOL","contactName":"Mrs Hala","contactPhone":"01099990001","contactEmail":"nour@e2e.local","address":"Kawther"}' | jq_ "d['data']['id']")
check "a partner is added; the same name again is refused" "$([ -n "$PN" ] && echo yes)/$(api POST /api/partners '{"name":"E2E Nour School","kind":"SCHOOL"}' | jq_ "d['success']")" "yes/False"
check "who sees the partners page: secretary no (role), admin yes (role default)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/partners)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/partners)" "403/200"
PNP=$(api POST /api/partners/$PN/places '{"name":"E2E Nour - Kawther"}' | jq_ "d['data']['id']")
check "a place of the partner is a PARTNER campus linked to it, with the partner contact filled in" "$(M "SELECT CONCAT(kind,'/',partnerId='$PN','/',phone) FROM Campus WHERE id='$PNP'")" "PARTNER/1/01099990001"
check "a place name already used by a branch is refused" "$(api POST /api/partners/$PN/places "{\"name\":\"$(M "SELECT name FROM Campus WHERE id='$CAMPUS'")\"}" | jq_ "d['success']")" "False"
check "the header filter lists the place under its partner" "$(api GET /api/places/mine | jq_ "[p['partner']['name'] for p in d['data']['places'] if p['id']=='$PNP']")" "['E2E Nour School']"
check "a contract that ends before it starts is refused" "$(api POST /api/partners/$PN/contracts "{\"title\":\"Bad\",\"startDate\":\"$(D 10)\",\"endDate\":\"$(D 1)\"}" | jq_ "d['success']")" "False"
PNC=$(api POST /api/partners/$PN/contracts "{\"title\":\"Year 2026/27\",\"startDate\":\"$(D -30)\",\"endDate\":\"$(D 10)\",\"alertDaysBefore\":30}" | jq_ "d['data']['id']")
check "the contract shows as ending soon (10 days)" "$(api GET /api/partners/$PN | jq_ "[(c['state'], c['daysLeft']) for c in d['data']['contracts']]")" "[('ENDING_SOON', 10)]"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "the daily job alerts the partner people once (Super Admin + Admin by role)" "$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE n.type='PARTNER_CONTRACT_ENDING' AND n.relatedId='$PN' AND u.email='m0admin@e2e.local'")" "1"
check "a file outside the partner folder is refused" "$(api POST /api/partner-contracts/$PNC/files '{"publicId":"somewhere/else/x","resourceType":"image","format":"jpg","bytes":100}' | jq_ "d['success']")" "False"
check "a partner with places cannot be deleted (stop it instead)" "$(api DELETE /api/partners/$PN | jq_ "d['success']")" "False"
api PUT /api/permissions/user/$SECU '{"items":[{"resource":"partners","action":"read","allowed":true}]}' >/dev/null
check "a personal rule gives the secretary the partners page (and it shows in her permissions)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/partners)/$(secapi GET /api/me/permissions | jq_ "'read' in d['data']['permissions'].get('partners', [])")" "200/True"
check "only Super Admin may set permissions" "$(adapi PUT /api/permissions/user/$SECU '{"items":[]}' | jq_ "d['success']")/$(adapi PUT /api/permissions/place/$CAMPUS '{"role":"ALL","items":[]}' | jq_ "d['success']")" "False/False"
api PUT /api/permissions/place/$CAMPUS '{"role":"ADMIN","items":[{"resource":"partners","action":"read","allowed":false}]}' >/dev/null
check "a place rule takes the partners page from the admins of that place" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/partners)" "403"
api PUT /api/permissions/user/$ADU '{"items":[{"resource":"partners","action":"read","allowed":true}]}' >/dev/null
check "the person's own rule wins over the place rule" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/partners)" "200"
api PUT /api/permissions/user/$ADU '{"items":[]}' >/dev/null
api PUT /api/permissions/place/$CAMPUS '{"role":"ADMIN","items":[]}' >/dev/null
api PUT /api/permissions/user/$SECU '{"items":[]}' >/dev/null
check "rules removed: back to the role settings" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/partners)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ADJ" $B/api/partners)" "403/200"
api PATCH /api/partners/$PN '{"name":"E2E Nour School","kind":"SCHOOL","isActive":false}' >/dev/null
check "stopping the partner stops its places" "$(M "SELECT isActive FROM Campus WHERE id='$PNP'")" "0"
rm -f "$ADJ"
echo "== 46. Partners part 1 (A): special prices, deals built from pieces, classes without names"
PS=$(api POST /api/partners '{"name":"E2E Sheraton Centre","kind":"CENTER","contactPhone":"01099990011"}' | jq_ "d['data']['id']")
PSP=$(api POST /api/partners/$PS/places '{"name":"E2E Sheraton Place"}' | jq_ "d['data']['id']")
GPS=$(api POST /api/groups "{\"campusId\":\"$PSP\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E Sheraton G\",\"sectionName\":\"A\",\"levelId\":\"$CL\"}" | jq_ "d['data']['id']")
api PUT /api/places/$PSP/prices "{\"items\":[{\"levelId\":\"$CL\",\"monthlyPrice\":600,\"fullLevelPrice\":600}]}" >/dev/null
check "a place price wins over the level price" "$(api GET /api/groups/$GPS | jq_ "d['data']['effectivePrice']")" "600"
check "the secretary cannot change a group price (money decision)" "$(secapi PATCH /api/groups/$GPS '{"priceOverride":10}' | jq_ "d['success']")" "False"
api PATCH /api/groups/$GPS '{"priceOverride":550}' >/dev/null
check "the group's own price wins over the place price" "$(api GET /api/groups/$GPS | jq_ "d['data']['effectivePrice']")" "550"
SPX=$(mkstu ShertKid 01066660151 Mona 01066660152); M "UPDATE Student SET campusId='$PSP' WHERE id='$SPX'"
api POST /api/groups/$GPS/students "{\"studentId\":\"$SPX\"}" >/dev/null
INVS=$(invid $SPX $GPS)
check "the new invoice uses the group price" "$(M "SELECT subtotal FROM FeeInvoice WHERE id='$INVS'")" "550.00"
api POST /api/fees/$INVS/payments "{\"amount\":$(M "SELECT ROUND(totalAmount-paidAmount,2) FROM FeeInvoice WHERE id='$INVS'"),\"paymentMethod\":\"Cash\"}" >/dev/null
check "a deal that takes a percentage from an institution that pays is refused" "$(api POST /api/partners/$PS/deals "{\"title\":\"Bad\",\"collector\":\"INSTITUTION\",\"components\":[{\"kind\":\"PERCENT\",\"value\":10}],\"validFrom\":\"$(D -60)\"}" | jq_ "d['success']")" "False"
DS=$(api POST /api/partners/$PS/deals "{\"title\":\"Sheraton 30%\",\"collector\":\"TECHNOVA\",\"components\":[{\"kind\":\"PERCENT\",\"value\":30}],\"validFrom\":\"$(D -60)\"}" | jq_ "d['data']['id']")
check "Sheraton: TechNova collected the invoice, the centre's 30% = TechNova owes 165" "$(api GET "/api/partner-deals/$DS/preview?from=$(D -1)&to=$(D 0)" | jq_ "(d['data']['facts']['collected'], d['data']['result']['balanceForTechNova'])")" "(550, -165)"
PNU=$(api POST /api/partners '{"name":"E2E Little Stars Nursery","kind":"NURSERY"}' | jq_ "d['data']['id']")
PNUP=$(api POST /api/partners/$PNU/places '{"name":"E2E Little Stars Place"}' | jq_ "d['data']['id']")
GNU=$(api POST /api/groups "{\"campusId\":\"$PNUP\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E KG1\",\"sectionName\":\"A\",\"levelId\":\"$CL\",\"unnamedHeadcount\":20}" | jq_ "d['data']['id']")
check "a class without names is made with its number of children" "$(M "SELECT unnamedHeadcount FROM ClassSection WHERE id='$GNU'")" "20"
check "a named group cannot record 'held' without attendance" "$(api POST /api/groups/$GPS/sessions "{\"date\":\"$(D 0)\",\"status\":\"HELD\"}" | jq_ "d['success']")" "False"
api POST /api/groups/$GNU/sessions "{\"date\":\"$(D 0)\",\"status\":\"HELD\",\"headcount\":18}" >/dev/null
api POST /api/groups/$GNU/sessions "{\"date\":\"$(D -1)\",\"status\":\"CANCELLED_PARTNER\",\"note\":\"school trip\"}" >/dev/null
check "the first held session starts the group (start date set)" "$(M "SELECT startDate IS NOT NULL FROM ClassSection WHERE id='$GNU'")" "1"
DN=$(api POST /api/partners/$PNU/deals "{\"title\":\"150 per session\",\"collector\":\"INSTITUTION\",\"components\":[{\"kind\":\"PER_SESSION\",\"value\":150}],\"countPartnerCancelled\":true,\"validFrom\":\"$(D -60)\"}" | jq_ "d['data']['id']")
check "nursery pays 150 per session; the session it cancelled counts → 300; 20 children" "$(api GET "/api/partner-deals/$DN/preview?from=$(D -1)&to=$(D 0)" | jq_ "(d['data']['result']['balanceForTechNova'], d['data']['facts']['students'])")" "(300, 20)"
api PATCH /api/partner-deals/$DN "{\"title\":\"150 per session\",\"collector\":\"INSTITUTION\",\"components\":[{\"kind\":\"PER_SESSION\",\"value\":150}],\"countPartnerCancelled\":false,\"validFrom\":\"$(D -60)\"}" >/dev/null
check "…and 150 when cancelled sessions do not count" "$(api GET "/api/partner-deals/$DN/preview?from=$(D -1)&to=$(D 0)" | jq_ "d['data']['result']['balanceForTechNova']")" "150"
check "the calendar shows the held session of the class without names" "$(api GET "/api/groups/schedule?from=$(D 0)&to=$(D 0)" | jq_ "[s['status'] for s in d['data']['sessions'] if s['groupId']=='$GNU' and s['date']=='$(D 0)']")" "['HELD']"
echo "== 47. Partners part 1 (B1): statements — make, manual lines, approve (frozen), payments both ways, carry-over"
ST1=$(api POST /api/partners/$PS/statements "{\"from\":\"$(D -1)\",\"to\":\"$(D 0)\"}" | jq_ "d['data']['id']")
check "Sheraton statement made as a draft from the deal: TechNova owes 165" "$(api GET /api/partner-statements/$ST1 | jq_ "(d['data']['status'], d['data']['totalDue'])")" "('DRAFT', -165)"
check "a second statement for the same period is refused" "$(api POST /api/partners/$PS/statements "{\"from\":\"$(D 0)\",\"to\":\"$(D 0)\"}" | jq_ "d['success']")" "False"
check "the secretary cannot see statements; approvers are told a statement waits" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/partners/$PS/statements)/$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE n.type='PARTNER_STATEMENT' AND u.email='m0admin@e2e.local'" | python -c "import sys;print(int(sys.stdin.read())>=1)")" "403/True"
api PATCH /api/partner-statements/$ST1 '{"manualLines":[{"label":"Agreed discount","amount":35,"payer":"TECHNOVA","reason":"opening month"}]}' >/dev/null
check "a manual line TechNova pays lowers the total (−200)" "$(api GET /api/partner-statements/$ST1 | jq_ "d['data']['totalDue']")" "-200"
ACJ=$(mktemp); login_jar $ACCE E2eAcc12345 "$ACJ" 10.0.2.11
check "an accountant can see statements but not approve them" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/partners/$PS/statements)/$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" -X POST $B/api/partner-statements/$ST1/approve)" "200/403"
rm -f "$ACJ"
api POST /api/partner-statements/$ST1/approve >/dev/null
check "approved: frozen (cannot change any more)" "$(api GET /api/partner-statements/$ST1 | jq_ "d['data']['status']")/$(api PATCH /api/partner-statements/$ST1 '{"manualLines":[]}' | jq_ "d['success']")" "APPROVED/False"
check "a payment the wrong way or more than the rest is refused" "$(api POST /api/partner-statements/$ST1/payments "{\"direction\":\"PARTNER_TO_TECHNOVA\",\"amount\":10,\"method\":\"Cash\",\"paidAt\":\"$(D 0)\"}" | jq_ "d['success']")/$(api POST /api/partner-statements/$ST1/payments "{\"direction\":\"TECHNOVA_TO_PARTNER\",\"amount\":500,\"method\":\"Cash\",\"paidAt\":\"$(D 0)\"}" | jq_ "d['success']")" "False/False"
api POST /api/partner-statements/$ST1/payments "{\"direction\":\"TECHNOVA_TO_PARTNER\",\"amount\":150,\"method\":\"Bank Transfer\",\"paidAt\":\"$(D 0)\",\"reference\":\"TRX-1\"}" >/dev/null
check "TechNova paid 150 of 200: partly paid, 50 left" "$(api GET /api/partner-statements/$ST1 | jq_ "(d['data']['status'], d['data']['rest'])")" "('PARTIAL', -50)"
ST2=$(api POST /api/partners/$PS/statements "{\"from\":\"$(D 1)\",\"to\":\"$(D 2)\"}" | jq_ "d['data']['id']")
api POST /api/partner-statements/$ST2/approve >/dev/null
check "the next statement carries the 50 left; the old one is marked carried" "$(api GET /api/partner-statements/$ST2 | jq_ "(d['data']['previousBalance'], d['data']['totalDue'])")/$(M "SELECT status FROM PartnerStatement WHERE id='$ST1'")" "(-50, -50)/CARRIED"
ST3=$(api POST /api/partners/$PNU/statements "{\"from\":\"$(D -1)\",\"to\":\"$(D 0)\"}" | jq_ "d['data']['id']")
api POST /api/partner-statements/$ST3/approve >/dev/null
api POST /api/partner-statements/$ST3/payments "{\"direction\":\"PARTNER_TO_TECHNOVA\",\"amount\":150,\"method\":\"Cash\",\"paidAt\":\"$(D 0)\"}" >/dev/null
check "nursery: owes 150 for the held session, pays it → settled" "$(api GET /api/partner-statements/$ST3 | jq_ "(d['data']['totalDue'], d['data']['status'])")" "(150, 'PAID')"
echo "== 48. Partners part 1 (B2): contacts, meetings + follow-ups, place people tabs, overview, partner report, Excel"
api POST /api/partners/$PS/contacts '{"name":"Mr Adel","role":"DECISION_MAKER","phone":"01099990021","isPrimary":true}' >/dev/null
api POST /api/partners/$PS/contacts '{"name":"Ms Rania","role":"FINANCE","phone":"01099990022","isPrimary":true}' >/dev/null
check "two contacts; only the last one marked main" "$(api GET /api/partners/$PS/contacts | jq_ "(len(d['data']), [c['name'] for c in d['data'] if c['isPrimary']])")" "(2, ['Ms Rania'])"
AF=$(api POST /api/partners/$PS/activities "{\"kind\":\"MEETING\",\"happenedAt\":\"$(D 0)\",\"summary\":\"Agreed on the new term\",\"followUpAt\":\"$(D 0)\"}" | jq_ "d['data']['id']")
check "a follow-up due today shows on the overview" "$(api GET /api/partners/overview | jq_ "any(f['id']=='$AF' for f in d['data']['followUps'])")" "True"
api PATCH /api/partner-activities/$AF "{\"kind\":\"MEETING\",\"happenedAt\":\"$(D 0)\",\"summary\":\"Agreed on the new term\",\"followUpAt\":\"$(D 0)\",\"followUpDone\":true}" >/dev/null
check "…and leaves it once done" "$(api GET /api/partners/overview | jq_ "any(f['id']=='$AF' for f in d['data']['followUps'])")" "False"
check "the overview shows what TechNova owes partners (the 50 carried at Sheraton)" "$(api GET /api/partners/overview | jq_ "[round(b['rest']) for b in d['data']['money']['byPartner'] if b['partnerId']=='$PS']")" "[-50]"
check "place tabs: the Sheraton place lists its group and student" "$(api GET "/api/places/people?campusIds=$PSP" | jq_ "(any(g['id']=='$GPS' for g in d['data']['groups']), any(s['id']=='$SPX' for s in d['data']['students']))")" "(True, True)"
api POST /api/places/$PSP/instructors "{\"teacherId\":\"$CALT\"}" >/dev/null
check "an instructor added to the place appears there; removed again he is gone" "$(api GET "/api/places/people?campusIds=$PSP" | jq_ "any(t['id']=='$CALT' for t in d['data']['instructors'])")/$(api DELETE "/api/places/$PSP/instructors?teacherId=$CALT" | jq_ "d['success']")/$(api GET "/api/places/people?campusIds=$PSP" | jq_ "any(t['id']=='$CALT' for t in d['data']['instructors'])")" "True/True/False"
check "a person who does not have the place gets nothing from it" "$(secapi GET "/api/places/people?campusIds=$PSP" | jq_ "(len(d['data']['groups']), len(d['data']['students']))")" "(0, 0)"
check "partner report for the nursery: 1 session held, 1 cancelled, 20 children" "$(api GET "/api/partners/$PNU/report?from=$(D -1)&to=$(D 0)" | jq_ "(d['data']['totals']['sessionsHeld'], d['data']['totals']['sessionsCancelled'], d['data']['totals']['students'])")" "(1, 1, 20)"
check "Excel: partners list downloads; statements need partner money access" "$(curl -s -o /dev/null -w '%{http_code}|%{content_type}' -b "$JAR" "$B/api/partners/export?kind=partners" | cut -c1-40)/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" "$B/api/partners/export?kind=statements")" "200|application/vnd.openxmlformats-offic/403"
echo "== 49. Rules & policies: policy drafts, public pages, group rules (automatic + written on 4 levels), parent must accept"
check "4 more policy drafts (terms, refund, attendance, payment) — 9 in all" "$(api GET /api/agreements | jq_ "(len(d['data']), sorted(a['key'] for a in d['data'] if a['key'] in ('terms','refund-policy','attendance-policy','payment-policy')))")" "(9, ['attendance-policy', 'payment-policy', 'refund-policy', 'terms'])"
TRM=$(M "SELECT id FROM Agreement WHERE \`key\`='terms'")
check "no public policy while they are switched off" "$(curl -s $B/api/public/policies | jq_ "len(d['data'])")/$(curl -s -o /dev/null -w '%{http_code}' $B/api/public/policies/terms)" "0/404"
api PATCH /api/agreements/$TRM '{"isActive":true,"isPublic":true}' >/dev/null
check "switched on + public: anyone can read it (no login); a non-public one stays hidden" "$(curl -s $B/api/public/policies/terms | jq_ "d['data']['titleEn']")/$(curl -s -o /dev/null -w '%{http_code}' $B/api/public/policies/payment-policy)" "Terms and conditions/404"
api PATCH /api/agreements/$TRM '{"isActive":false}' >/dev/null
WG=$(M "SELECT classSectionId FROM StudentEnrollment WHERE studentId='$W1' AND status='ACTIVE' LIMIT 1")
check "a group shows automatic rules (absence, refunds) and its families" "$(api GET /api/groups/$WG/rules | jq_ "(any('absence counts' in i['en'] for i in d['data']['items']), any('refund' in i['en'].lower() for i in d['data']['items']), len(d['data']['families'])>=1)")" "(True, True, True)"
AWJ=$(mktemp); login_as 01066660099 Wallet2026A "$AWJ" >/dev/null
gpend() { curl -s -b "$AWJ" "$B/api/guardian-portal/group-rules"; }
GH=$(gpend | jq_ "[p['hash'] for p in d['data'] if p['studentId']=='$W1' and p['groupId']=='$WG'][0]")
check "the parent must accept the rules of the child's group" "$([ ${#GH} -eq 64 ] && echo yes)" "yes"
check "accepting with old rules or for someone else's child is refused" "$(curl -s -b "$AWJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$WG\",\"studentId\":\"$W1\",\"hash\":\"$(printf 'a%.0s' $(seq 1 64))\"}" $B/api/guardian-portal/group-rules | jq_ "d['success']")/$(curl -s -b "$AWJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$GPS\",\"studentId\":\"$SPX\",\"hash\":\"$GH\"}" $B/api/guardian-portal/group-rules | jq_ "d['success']")" "False/False"
curl -s -b "$AWJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$WG\",\"studentId\":\"$W1\",\"hash\":\"$GH\"}" $B/api/guardian-portal/group-rules >/dev/null
check "accepted: no longer asked, and staff see the family as accepted" "$(gpend | jq_ "any(p['studentId']=='$W1' and p['groupId']=='$WG' for p in d['data'])")/$(api GET /api/groups/$WG/rules | jq_ "[f['acceptedAt'] is not None for f in d['data']['families'] if f['studentId']=='$W1']")" "False/[True]"
check "the secretary cannot write group rules" "$(secapi POST /api/group-rules '{"scope":"GLOBAL","textEn":"x rule","textAr":"قاعدة"}' | jq_ "d['success']")" "False"
GR=$(api POST /api/group-rules '{"scope":"GLOBAL","textEn":"Be on time, please.","textAr":"من فضلك خليك في المعاد."}' | jq_ "d['data']['id']")
api POST /api/group-rules "{\"scope\":\"GROUP\",\"scopeId\":\"$WG\",\"textEn\":\"Bring the laptop.\",\"textAr\":\"هات اللابتوب.\"}" >/dev/null
check "company + group rules are added (company first, then this group)" "$(api GET /api/groups/$WG/rules | jq_ "[i['source'] for i in d['data']['items'] if i['source']!='AUTO']")" "['GLOBAL', 'GROUP']"
check "a change asks the parent again (marked updated)" "$(gpend | jq_ "[p['updated'] for p in d['data'] if p['studentId']=='$W1' and p['groupId']=='$WG']")" "[True]"
api DELETE /api/group-rules/$GR >/dev/null
rm -f "$AWJ"
echo "== 50. 5-C: settings centre, reports centre, 'your work today' per role"
TK() { python -c "import sys,json;d=json.load(sys.stdin);t={x['key']:x['count'] for x in d['data']['tasks']};print($1)" 2>/dev/null; }
TD=$(api GET /api/today)
check "today (Super Admin): only jobs with something waiting, urgent first" "$(echo "$TD" | python -c "import sys,json;t=json.load(sys.stdin)['data']['tasks'];print(all(x['count']>0 for x in t) and [x['urgent'] for x in t]==sorted([x['urgent'] for x in t],reverse=True))")" "True"
check "today: payment receipts to check = the receipts really waiting" "$(echo "$TD" | TK "t.get('proofs',0)")" "$(M "SELECT COUNT(*) FROM FeeInvoice WHERE proofStatus='PENDING'")"
check "today: wallet receipts + refunds waiting = the database" "$(echo "$TD" | TK "(t.get('topUps',0), t.get('refunds',0))")" "($(M "SELECT COUNT(*) FROM WalletTopUp WHERE status='PENDING'"), $(M "SELECT COUNT(*) FROM Refund WHERE status='PENDING'"))"
check "today (secretary): no refund approvals, own work only" "$(secapi GET /api/today | TK "'refunds' not in t and 'partnerStatements' not in t")" "True"
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.90 >/dev/null
check "today (instructor): only instructor jobs" "$(curl -s -b "$TJ" $B/api/today | TK "set(t) <= {'mySessionsToday','myMissingAttendance','homeworkToGrade','substituteRequests'}")" "True"
rm -f "$TJ"
check "settings centre and reports centre open" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $B/dashboard/settings-center)/$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $B/dashboard/reports-center)" "200/200"
echo "== 51. 5-D targeted announcements: who x where, approval by permission, read / I read it, scheduled, follow-up"
AWJ=$(mktemp); login_as 01066660099 Wallet2026A "$AWJ" >/dev/null
pa() { curl -s -b "$AWJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
PV=$(api POST /api/announcements/preview "{\"audiences\":[\"PARENT\",\"STUDENT\"],\"scopeType\":\"GROUP\",\"scopeIds\":[\"$WG\"]}")
PVN=$(echo "$PV" | jq_ "d['data']['count']")
check "preview: how many people a group announcement reaches" "$(echo "$PV" | jq_ "d['data']['count']>=2 and d['data']['problem'] is None")" "True"
AN=$(api POST /api/announcements "{\"title\":\"Trip on Friday\",\"body\":\"We visit the science museum.\",\"titleAr\":\"\\u0631\\u062d\\u0644\\u0629 \\u064a\\u0648\\u0645 \\u0627\\u0644\\u062c\\u0645\\u0639\\u0629\",\"contentAr\":\"\\u0647\\u0646\\u0632\\u0648\\u0631 \\u0645\\u062a\\u062d\\u0641 \\u0627\\u0644\\u0639\\u0644\\u0648\\u0645.\",\"audiences\":[\"PARENT\",\"STUDENT\"],\"scopeType\":\"GROUP\",\"scopeIds\":[\"$WG\"],\"requireAck\":true}")
AID=$(echo "$AN" | jq_ "d['data']['id']")
check "a manager publishes at once (has approve)" "$(echo "$AN" | jq_ "d['data']['status']")" "PUBLISHED"
check "recipients = the preview, notified in both languages" "$(M "SELECT recipientCount FROM Announcement WHERE id='$AID'")/$(M "SELECT COUNT(*) FROM Notification WHERE type='ANNOUNCEMENT' AND relatedId='$AID' AND titleAr IS NOT NULL AND titleAr<>title AND messageAr IS NOT NULL")" "$PVN/$PVN"
check "the parent sees it, important and not confirmed yet" "$(pa GET /api/announcements | PYTHONUTF8=1 jq_ "[(x['titleAr']=='\\u0631\\u062d\\u0644\\u0629 \\u064a\\u0648\\u0645 \\u0627\\u0644\\u062c\\u0645\\u0639\\u0629', x['requireAck'], x['ackAt']) for x in d['data'] if x['id']=='$AID']")" "[(True, True, None)]"
pa POST /api/announcements/$AID/read '{"ack":true}' >/dev/null
check "the parent confirms 'I read it' → counted for the sender" "$(api GET /api/announcements/$AID | jq_ "d['data']['reach']['acked']>=1 and d['data']['reach']['read']>=1")" "True"
check "a parent cannot open the sender view" "$(pa GET /api/announcements/$AID | jq_ "d['success']")" "False"
check "follow-up calls for parents who did not confirm" "$(api POST /api/announcements/$AID/follow-up | jq_ "d['success']")" "True"
check "a secretary cannot send to the whole company" "$(secapi POST /api/announcements '{"title":"All","body":"Hello all","audiences":["PARENT"],"scopeType":"COMPANY","scopeIds":[]}' | jq_ "d['success']")" "False"
SA=$(secapi POST /api/announcements "{\"title\":\"Branch news\",\"body\":\"New robots arrived.\",\"audiences\":[\"PARENT\"],\"scopeType\":\"CAMPUS\",\"scopeIds\":[\"$CAMPUS\"]}")
SAID=$(echo "$SA" | jq_ "d['data']['id']")
check "a secretary (no approve) waits for approval; approvers are told" "$(echo "$SA" | jq_ "d['data']['status']")/$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='ANNOUNCEMENT_PENDING' AND relatedId='$SAID'")" "PENDING/1"
check "'your work today' shows it to the approver" "$(api GET /api/today | jq_ "any(t['key']=='announcementsToApprove' for t in d['data']['tasks'])")" "True"
api PATCH /api/announcements/$SAID '{"action":"approve"}' >/dev/null
check "approved → published and delivered, the sender is told" "$(M "SELECT CONCAT(status,'/',deliveredAt IS NOT NULL) FROM Announcement WHERE id='$SAID'")/$(M "SELECT COUNT(*) FROM Notification WHERE type='ANNOUNCEMENT_DECIDED' AND relatedId='$SAID'")" "PUBLISHED/1/1"
BJ=$(mktemp); login_jar m0secb@e2e.local E2eSecB12345 "$BJ" 10.0.1.91 >/dev/null
check "another branch's secretary cannot send to this group" "$(curl -s -b "$BJ" -X POST -H 'Content-Type: application/json' -d "{\"title\":\"X\",\"body\":\"Not mine\",\"audiences\":[\"PARENT\"],\"scopeType\":\"GROUP\",\"scopeIds\":[\"$WG\"]}" $B/api/announcements | jq_ "d['success']")" "False"
rm -f "$BJ"
LATER=$(python -c "import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
LA=$(api POST /api/announcements "{\"title\":\"Next week\",\"body\":\"Coming soon.\",\"audiences\":[\"PARENT\"],\"scopeType\":\"GROUP\",\"scopeIds\":[\"$WG\"],\"publishAt\":\"$LATER\"}" | jq_ "d['data']['id']")
check "published for later: nobody gets it yet" "$(M "SELECT deliveredAt IS NULL FROM Announcement WHERE id='$LA'")/$(pa GET /api/announcements | jq_ "any(x['id']=='$LA' for x in d['data'])")" "1/False"
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.92 >/dev/null
TG=$(curl -s -b "$TJ" $B/api/announcements/options | jq_ "d['data']['groups'][0]['id'] if d['data']['groups'] else ''")
check "an instructor sends to own group (waits for approval) but not to a level" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"title\":\"Homework\",\"body\":\"Finish the robot arm.\",\"audiences\":[\"PARENT\"],\"scopeType\":\"GROUP\",\"scopeIds\":[\"$TG\"]}" $B/api/announcements | jq_ "d['data']['status']")/$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"title\":\"All\",\"body\":\"Level news\",\"audiences\":[\"PARENT\"],\"scopeType\":\"LEVEL\",\"scopeIds\":[\"$NLEVEL\"]}" $B/api/announcements | jq_ "d['success']")" "PENDING/False"
api PUT /api/announcements/settings '{"teachersCanSend":false}' >/dev/null
check "setting off → instructors cannot send" "$(curl -s -b "$TJ" -X POST -H 'Content-Type: application/json' -d "{\"title\":\"Homework\",\"body\":\"Again please.\",\"audiences\":[\"PARENT\"],\"scopeType\":\"GROUP\",\"scopeIds\":[\"$TG\"]}" $B/api/announcements | jq_ "d['success']")" "False"
api PUT /api/announcements/settings '{"teachersCanSend":true}' >/dev/null
rm -f "$TJ" "$AWJ"
echo "== 52. document numbers: payments at the same moment get different receipt numbers (locked counter)"
# payable invoices: issued, nothing refunded, the student still active in an active group
PAR=$(M "SELECT CONCAT(i.id,':',CAST(i.totalAmount-i.paidAmount AS DECIMAL(10,2))) FROM FeeInvoice i JOIN StudentEnrollment e ON e.studentId=i.studentId AND e.classSectionId=i.classSectionId AND e.status='ACTIVE' JOIN ClassSection g ON g.id=i.classSectionId AND g.status='ACTIVE' WHERE i.status='ISSUED' AND i.totalAmount>i.paidAmount AND i.refundedAmount=0 AND i.proofStatus IS NULL GROUP BY i.id ORDER BY i.createdAt DESC LIMIT 4")
PDIR=$(mktemp -d); i=0; PIDS=""
for row in $PAR; do i=$((i+1)); ( api POST /api/fees/${row%%:*}/payments "{\"amount\":${row##*:},\"paymentMethod\":\"Cash\"}" > "$PDIR/$i.json" ) & PIDS="$PIDS $!"; done
wait $PIDS   # only these requests (a bare wait would also wait for the app server)
for f in "$PDIR"/*.json; do grep -q '"success":true' "$f" || echo "    refused: $(head -c 300 "$f")"; done
check "4 payments sent at once: all saved" "$(grep -l '"success":true' "$PDIR"/*.json | wc -l | tr -d ' ')" "$(echo "$PAR" | wc -w | tr -d ' ')"
check "…each with its own receipt number (no duplicates)" "$(M "SELECT COUNT(*)=COUNT(DISTINCT receiptNumber) FROM FeePayment WHERE receiptNumber IS NOT NULL")" "1"
check "the counter is at the highest receipt number" "$(M "SELECT c.value=MAX(CAST(SUBSTRING(p.receiptNumber,14) AS UNSIGNED)) FROM DocumentCounter c JOIN FeePayment p ON p.receiptNumber LIKE CONCAT(c.\`key\`,'%') WHERE c.\`key\` LIKE 'TN-RCPT-%' GROUP BY c.value")" "1"
rm -rf "$PDIR"
echo "== 53. import / export: Excel template, check before saving, import through the real APIs, export Excel / PDF, permissions + places"
DX=$(mktemp -d)
check "the tables an admin may import / export" "$(api GET /api/data | jq_ "sorted(x['key'] for x in d['data'] if x['import'])")" "['courseStructure', 'groups', 'instructors', 'students']"
check "student template is a real Excel file with the dropdown lists" "$(curl -s -b "$JAR" -o "$DX/t.xlsx" -w '%{http_code}' "$B/api/data/students/template?lang=en")/$(head -c 2 "$DX/t.xlsx")" "200/PK"
CNAME=$(M "SELECT name FROM Campus WHERE id='$CAMPUS'")
IGRP=$(M "SELECT id FROM ClassSection WHERE campusId='$CAMPUS' AND status='ACTIVE' AND levelId IS NOT NULL AND (maxStudents IS NULL OR maxStudents>20) ORDER BY createdAt DESC LIMIT 1")
IGNAME=$(M "SELECT CONCAT(className,' ',sectionName,' · ','$CNAME') FROM ClassSection WHERE id='$IGRP'")
cat > "$DX/rows.json" <<JSON
[{"First name":"Importa","Last name":"Kid","Full Arabic name":"Importa Kid One","Father name":"Sami","Gender":"Male","Date of birth":"21/03/2016","Student / home phone":"01077770001","Emergency phone":"01077770001","Address":"Hurghada street 1","City":"Hurghada","Branch / place":"$CNAME","Group (optional)":"$IGNAME","Parent first name":"Sami","Parent last name":"Kid","Parent phone":"01077770009"},
 {"First name":"Importb","Last name":"Kid","Full Arabic name":"Importb Kid Two","Father name":"Sami","Gender":"Female","Date of birth":"2017-05-02","Student / home phone":"1077770002","Emergency phone":"01077770002","Address":"Hurghada street 2","City":"Hurghada","Branch / place":"$CNAME","Parent first name":"Sami","Parent phone":"01077770009"},
 {"First name":"Badrow","Last name":"Kid","Full Arabic name":"Bad Row Kid","Father name":"X","Gender":"Robot","Date of birth":"32/13/2016","Student / home phone":"12","Emergency phone":"01077770003","Address":"Somewhere far","City":"Hurghada","Branch / place":"Planet Mars"}]
JSON
node scripts/e2e/fill-template.cjs "$DX/t.xlsx" "$DX/filled.xlsx" "$DX/rows.json"
PRE=$(curl -s -b "$JAR" -F "file=@$DX/filled.xlsx" "$B/api/data/students/import")
check "upload is checked first: 3 rows, 2 ready, the bad one explained (nothing saved yet)" "$(echo "$PRE" | jq_ "(len(d['data']['rows']), d['data']['valid'], len([e for e in d['data']['rows'][2]['errors']]))")/$(M "SELECT COUNT(*) FROM Student WHERE firstName IN ('Importa','Importb')")" "(3, 2, 4)/0"
GOOD=$(echo "$PRE" | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(json.dumps({'rows':[{'row':r['row'],'values':r['values']} for r in d['rows'] if not r['errors']],'fileName':'filled.xlsx'}))")
COM=$(api POST /api/data/students/import/commit "$GOOD")
check "import through the real admission API: both saved" "$(echo "$COM" | jq_ "(d['data']['created'], d['data']['failed'])")" "(2, 0)"
check "…registration numbers TN/YYYY/NNNN, phone fixed (leading 0), ONE parent found by phone for both" "$(M "SELECT CONCAT(SUM(registrationNumber LIKE 'TN/____/____'),'/',SUM(phoneNumber='01077770002')) FROM Student WHERE firstName IN ('Importa','Importb')")/$(M "SELECT COUNT(*) FROM Guardian WHERE phoneNumber='01077770009'")" "2/1/1"
IA=$(M "SELECT id FROM Student WHERE firstName='Importa'")
check "…the group row joined the group and got its invoice (same as by hand)" "$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE studentId='$IA' AND classSectionId='$IGRP' AND status='ACTIVE'")/$(M "SELECT COUNT(*)>0 FROM FeeInvoice WHERE studentId='$IA'")" "1/1"
check "import log: who, file, 2 done" "$(M "SELECT CONCAT(created,'/',failed,'/',fileName) FROM DataExchangeLog WHERE kind='IMPORT' AND dataset='students' ORDER BY createdAt DESC LIMIT 1")" "2/0/filled.xlsx"
BAD=$(echo "$PRE" | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(json.dumps({'rows':[{'row':r['row'],'values':r['values'],'reason':'; '.join(e['en'] for e in r['errors'])} for r in d['rows'] if r['errors']],'lang':'en'}))")
check "rows to fix come back as an Excel file" "$(curl -s -b "$JAR" -o "$DX/fix.xlsx" -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "$BAD" "$B/api/data/students/import/failures")/$(head -c 2 "$DX/fix.xlsx")" "200/PK"
check "a secretary without the import permission cannot import (Permissions page can give it)" "$(secapi GET /api/data | jq_ "any(x['key']=='students' and x['import'] for x in d['data'])")/$(curl -s -b "$SECJ" -F "file=@$DX/filled.xlsx" -o /dev/null -w '%{http_code}' "$B/api/data/students/import")" "False/403"
check "export Excel: a real file, logged" "$(curl -s -b "$JAR" -o "$DX/e.xlsx" -w '%{http_code}' "$B/api/data/students/export?format=xlsx&lang=ar")/$(head -c 2 "$DX/e.xlsx")/$(M "SELECT COUNT(*)>0 FROM DataExchangeLog WHERE kind='EXPORT' AND dataset='students' AND format='xlsx'")" "200/PK/1"
check "export rows = every student (Super Admin sees all places)" "$(api GET "/api/data/students/export?format=json" | jq_ "d['data']['count']")" "$(M "SELECT COUNT(*) FROM Student")"
BJ=$(mktemp); login_jar m0secb@e2e.local E2eSecB12345 "$BJ" 10.0.1.93 >/dev/null
check "another branch's secretary exports only her place's students" "$(curl -s -b "$BJ" "$B/api/data/students/export?format=json" | jq_ "d['data']['count']")" "$(M "SELECT COUNT(*) FROM Student WHERE campusId='$PB'")"
rm -f "$BJ"
check "printable PDF page opens" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$B/reports/data/invoices?lang=ar")" "200"
curl -s -b "$JAR" -o "$DX/c.xlsx" "$B/api/data/courseStructure/template?lang=en"
cat > "$DX/c.json" <<JSON
[{"Track":"E2E Drones","Course":"SkyKids","Level":"Level 1","Level order":1,"Sessions":8,"Months":1,"Pricing":"Monthly","Price (EGP)":700},
 {"Track":"E2E Drones","Course":"SkyKids","Level":"Level 2","Level order":2,"Sessions":8,"Months":1,"Pricing":"Monthly","Price (EGP)":750}]
JSON
node scripts/e2e/fill-template.cjs "$DX/c.xlsx" "$DX/cf.xlsx" "$DX/c.json"
CP=$(curl -s -b "$JAR" -F "file=@$DX/cf.xlsx" "$B/api/data/courseStructure/import")
CG=$(echo "$CP" | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(json.dumps({'rows':[{'row':r['row'],'values':r['values']} for r in d['rows'] if not r['errors']]}))")
check "course structure: missing track + course made once, both levels added" "$(api POST /api/data/courseStructure/import/commit "$CG" | jq_ "d['data']['created']")/$(M "SELECT COUNT(*) FROM Level l JOIN AcademicSubject s ON s.id=l.subjectId JOIN Track t ON t.id=s.trackId WHERE t.name='E2E Drones'")/$(M "SELECT COUNT(*) FROM Track WHERE name='E2E Drones'")" "2/2/1"
LNAME="SkyKids — Level 1"
curl -s -b "$JAR" -o "$DX/g.xlsx" "$B/api/data/groups/template?lang=en"
cat > "$DX/g.json" <<JSON
[{"Group name":"E2E Imported Group","Section":"Z","Branch / place":"$CNAME","Course — level":"$LNAME","Schedule":"Sun 16:00, Wed 4:30 pm","Max students":10}]
JSON
node scripts/e2e/fill-template.cjs "$DX/g.xlsx" "$DX/gf.xlsx" "$DX/g.json"
GP=$(curl -s -b "$JAR" -F "file=@$DX/gf.xlsx" "$B/api/data/groups/import")
GG=$(echo "$GP" | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(json.dumps({'rows':[{'row':r['row'],'values':r['values']} for r in d['rows'] if not r['errors']]}))")
check "groups: made through the Groups API with its schedule (shift picked from the time)" "$(api POST /api/data/groups/import/commit "$GG" | jq_ "d['data']['created']")/$(M "SELECT CONCAT(maxStudents,'/',JSON_LENGTH(scheduleSlots)) FROM ClassSection WHERE className='E2E Imported Group'")" "1/10/2"
curl -s -b "$JAR" -o "$DX/i.xlsx" "$B/api/data/instructors/template?lang=en"
cat > "$DX/i.json" <<JSON
[{"First name":"Imported","Last name":"Coach","National ID":"29001011234567","Gender":"Female","Date of birth":"1995-06-01","Phone":"01077770050","Email (login)":"imported.coach@e2e.local","Address":"Hurghada 10","City":"Hurghada","Emergency phone":"01077770051","Job title":"Instructor","Joining date":"2026-09-01","Branch / place":"$CNAME"}]
JSON
node scripts/e2e/fill-template.cjs "$DX/i.xlsx" "$DX/if.xlsx" "$DX/i.json"
IP=$(curl -s -b "$JAR" -F "file=@$DX/if.xlsx" "$B/api/data/instructors/import")
IG=$(echo "$IP" | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(json.dumps({'rows':[{'row':r['row'],'values':r['values']} for r in d['rows'] if not r['errors']]}))")
check "instructors: 14-digit Egyptian national ID accepted, login made with the email" "$(api POST /api/data/instructors/import/commit "$IG" | jq_ "d['data']['created']")/$(M "SELECT COUNT(*) FROM Teacher t JOIN User u ON u.id=t.userId WHERE t.cnic='29001011234567' AND u.email='imported.coach@e2e.local'")" "1/1"
ADMB=$(stu Admbill 01077770070 '' '' | python -c "import sys,json;d=json.load(sys.stdin);d['classSectionId']='$IGRP';print(json.dumps(d))")
ADMR=$(api POST /api/students "$ADMB")
ADMID=$(echo "$ADMR" | jq_ "d['data']['id']")
check "admission form with a group bills the month at once (same as Add to group)" "$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE studentId='$ADMID' AND classSectionId='$IGRP' AND status='ACTIVE'")/$(M "SELECT COUNT(*) FROM FeeInvoice WHERE studentId='$ADMID' AND classSectionId='$IGRP'")" "1/1"
rm -rf "$DX"
echo "== 54. FIN-1 money accounts: routes, automatic movements, transfers (two people), daily cash count, expense categories"
TBOX=$(api POST /api/treasury/accounts "{\"name\":\"E2E main cash box\",\"kind\":\"CASH\",\"campusId\":\"$CAMPUS\",\"openingBalance\":1000}" | jq_ "d['data']['id']")
TBANK=$(api POST /api/treasury/accounts '{"name":"E2E bank","kind":"BANK","campusId":null,"openingBalance":0}' | jq_ "d['data']['id']")
check "accounts made: a branch cash box and a company bank account" "$(M "SELECT COUNT(*) FROM MoneyAccount WHERE id IN ('$TBOX','$TBANK')")" "2"
check "nothing placed before the routes are set (money waits as 'not placed')" "$(api GET /api/treasury | jq_ "d['data']['unplaced']['count']>0")" "True"
api PUT /api/treasury/routes "{\"method\":\"Cash\",\"campusId\":\"$CAMPUS\",\"accountId\":\"$TBOX\"}" >/dev/null
api PUT /api/treasury/routes "{\"method\":\"Bank Transfer\",\"campusId\":null,\"accountId\":\"$TBANK\"}" >/dev/null
check "every staff / receipt / online payment became one movement; wallet payments did not (money came in once)" "$(M "SELECT COUNT(*) FROM FeePayment WHERE status='COMPLETED' AND (source IS NULL OR source IN ('STAFF','PROOF','ONLINE'))")/$(M "SELECT COUNT(*) FROM MoneyMovement m JOIN FeePayment p ON p.id=m.feePaymentId WHERE p.source='WALLET'")" "$(M "SELECT COUNT(*) FROM MoneyMovement WHERE kind='PAYMENT'")/0"
check "setting the route placed the waiting cash of this branch in its box" "$(M "SELECT COUNT(*) FROM MoneyMovement m LEFT JOIN Campus c ON c.id=m.campusId WHERE m.accountId IS NULL AND m.method='Cash' AND m.campusId='$CAMPUS'")" "0"
B0=$(api GET /api/treasury | jq_ "float([a['balance'] for a in d['data']['accounts'] if a['id']=='$TBOX'][0])")
check "box balance = opening + in − out (from the opening date)" "$B0" "$(M "SELECT CAST(1000 + COALESCE(SUM(CASE WHEN direction='IN' THEN amount ELSE -amount END),0) AS DECIMAL(12,1)) FROM MoneyMovement m JOIN MoneyAccount a ON a.id=m.accountId WHERE m.accountId='$TBOX' AND m.date >= a.openingDate - INTERVAL $CAIRO_OFF HOUR" | python -c "import sys;print(float(sys.stdin.read()))")"
TINV=$(M "SELECT i.id FROM FeeInvoice i JOIN ClassSection g ON g.id=i.classSectionId JOIN StudentEnrollment e ON e.classSectionId=g.id AND e.studentId=i.studentId AND e.status='ACTIVE' WHERE g.campusId='$CAMPUS' AND g.status='ACTIVE' AND i.status='ISSUED' AND i.paidAmount=0 AND i.refundedAmount=0 AND i.proofStatus IS NULL ORDER BY i.createdAt DESC LIMIT 1")
TAMT=$(M "SELECT CAST(totalAmount AS DECIMAL(10,2)) FROM FeeInvoice WHERE id='$TINV'")
pay "$TINV" "$TAMT" >/dev/null
check "a new cash payment lands in this branch's box at once" "$(api GET /api/treasury | jq_ "float(round([a['balance'] for a in d['data']['accounts'] if a['id']=='$TBOX'][0] - $B0, 2))")" "$(python -c "print(float(round(float('$TAMT'),2)))")"
TCAT=$(api POST /api/expense-categories '{"nameEn":"E2E Rent","nameAr":"إيجار"}' | jq_ "d['data']['id']")
TEX=$(api POST /api/accountant/expenses "{\"title\":\"E2E rent October\",\"amount\":200,\"categoryId\":\"$TCAT\",\"date\":\"$(D 0)\",\"campusId\":\"$CAMPUS\",\"paymentSource\":\"Cash\"}" | jq_ "d['data']['id']")
check "a new expense category is used, the old column is filled (Other), the expense filter finds it" "$(M "SELECT CONCAT(category,'/',categoryId='$TCAT') FROM Expense WHERE id='$TEX'")/$(api GET "/api/accountant/expenses?categoryId=$TCAT&limit=5" | jq_ "len(d['data'])")" "MISCELLANEOUS/1/1"
check "the expense left the box (money out)" "$(api GET /api/treasury >/dev/null; M "SELECT CONCAT(direction,'/',CAST(amount AS DECIMAL(10,0)),'/',accountId='$TBOX') FROM MoneyMovement WHERE expenseId='$TEX'")" "OUT/200/1"
api DELETE /api/accountant/expenses/$TEX >/dev/null
check "a deleted expense is taken back out of the box" "$(api GET /api/treasury >/dev/null; M "SELECT COUNT(*) FROM MoneyMovement WHERE expenseId='$TEX'")" "0"
TT=$(api POST /api/treasury/transfers "{\"fromAccountId\":\"$TBOX\",\"toAccountId\":\"$TBANK\",\"amount\":100,\"note\":\"deposit\"}")
TTID=$(echo "$TT" | jq_ "d['data']['id']")
check "transfer box → bank waits for a second person (numbered TN-TRF)" "$(echo "$TT" | jq_ "(d['data']['status'], d['data']['number'][:7])")" "('PENDING', 'TN-TRF-')"
check "Super Admin may approve own transfer; a secretary cannot approve" "$(api PATCH /api/treasury/transfers/$TTID '{"action":"approve"}' | jq_ "d['success']")/$(secapi PATCH /api/treasury/transfers/$TTID '{"action":"approve"}' | jq_ "d['success']")" "True/False"
check "approved (Super Admin may approve own) → out of the box, into the bank" "$(M "SELECT GROUP_CONCAT(CONCAT(direction,':',accountId='$TBOX') ORDER BY direction) FROM MoneyMovement WHERE transferId='$TTID'")" "IN:0,OUT:1"
B1=$(api GET /api/treasury | jq_ "[a['balance'] for a in d['data']['accounts'] if a['id']=='$TBOX'][0]")
CNT=$(secapi POST /api/treasury/counts "{\"accountId\":\"$TBOX\",\"counted\":$(python -c "print($B1-50)"),\"note\":\"short\"}")
CID=$(echo "$CNT" | jq_ "d['data']['id']")
check "end-of-day count by the secretary: 50 short → waits for approval" "$(echo "$CNT" | jq_ "(d['data']['status'], float(d['data']['difference']))")" "('PENDING', -50.0)"
check "'your work today' shows the count difference to the manager" "$(api GET /api/today | jq_ "any(t['key']=='cashCountsToApprove' for t in d['data']['tasks'])")" "True"
api PATCH /api/treasury/counts/$CID '{"action":"approve"}' >/dev/null
check "approved → the difference is booked (box − 50)" "$(api GET /api/treasury | jq_ "round($B1 - [a['balance'] for a in d['data']['accounts'] if a['id']=='$TBOX'][0], 2)")" "50"
# 2026-10-24 (owner): a branch accountant deposits the branch cash in the company bank; someone who sees every place approves
ACJ=$(mktemp); login_jar $ACCE E2eAcc12345 "$ACJ" 10.0.2.31
check "branch accountant: the company bank is offered as a destination" "$(accapi GET /api/treasury/transfers/destinations | jq_ "any(a['id']=='$TBANK' and a['company'] for a in d['data'])")" "True"
api PUT /api/treasury/settings '{"transferNeedsApproval":false}' >/dev/null
BT=$(accapi POST /api/treasury/transfers "{\"fromAccountId\":\"$TBOX\",\"toAccountId\":\"$TBANK\",\"amount\":20,\"note\":\"branch deposit\"}")
BTID=$(echo "$BT" | jq_ "d['data']['id']")
check "branch → company transfer always waits for approval (even with approvals switched off)" "$(echo "$BT" | jq_ "d['data']['status']")" "PENDING"
api PUT /api/treasury/settings '{"transferNeedsApproval":true}' >/dev/null
check "Super Admin approves it → into the company bank" "$(api PATCH /api/treasury/transfers/$BTID '{"action":"approve"}' | jq_ "d['success']")/$(M "SELECT GROUP_CONCAT(CONCAT(direction,':',accountId='$TBANK') ORDER BY direction) FROM MoneyMovement WHERE transferId='$BTID'")" "True/IN:1,OUT:0"
api PUT /api/treasury/settings '{"branchToCompany":false}' >/dev/null
check "setting off → the branch cannot send to company accounts" "$(accapi POST /api/treasury/transfers "{\"fromAccountId\":\"$TBOX\",\"toAccountId\":\"$TBANK\",\"amount\":5}" | jq_ "d['success']")/$(accapi GET /api/treasury/transfers/destinations | jq_ "any(a['id']=='$TBANK' for a in d['data'])")" "False/False"
api PUT /api/treasury/settings '{"branchToCompany":true}' >/dev/null
# 2026-10-24 live test: an instructor paid per session has no basic salary; the month may be written in Arabic
TCHU=$(M "SELECT userId FROM Teacher t JOIN User u ON u.id=t.userId WHERE u.email='tch@e2e.local'")
check "the instructor list gives the user id the salary-slip screen sends (live test: slips sent the teacher id)" "$(accapi GET "/api/teachers?limit=100" | jq_ "any(t.get('userId')=='$TCHU' for t in d['data'])")" "True"
check "salary slip: basic 0 + group pay line in Arabic month is issued; an empty slip is refused" "$(accapi POST /api/accountant/salary-slips "{\"employeeId\":\"$TCHU\",\"month\":\"أكتوبر 2026\",\"salaryPeriodStart\":\"2026-10-01T00:00:00.000Z\",\"salaryPeriodEnd\":\"2026-10-31T23:59:59.000Z\",\"basicSalary\":0,\"customFields\":[{\"label\":\"Group pay\",\"value\":300,\"isDeduction\":false}]}" | jq_ "(d['success'], float(d['data']['netSalary']))")/$(accapi POST /api/accountant/salary-slips "{\"employeeId\":\"$TCHU\",\"month\":\"نوفمبر 2026\",\"salaryPeriodStart\":\"2026-11-01T00:00:00.000Z\",\"salaryPeriodEnd\":\"2026-11-30T23:59:59.000Z\",\"basicSalary\":0}" | jq_ "d['success']")" "(True, 300.0)/False"
# 2026-10-24 (owner): instructors never see invoices, only their own groups' students; the slip is a setting
TJ2=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ2" 10.0.2.51
tchapi() { curl -s -b "$TJ2" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
TSIDS=$(tchapi GET "/api/students?limit=200" | python -c "import sys,json;d=json.load(sys.stdin);r=d.get('data');r=r.get('students',r) if isinstance(r,dict) else r;print(','.join(\"'\"+x['id']+\"'\" for x in (r or [])) or \"''\")")
check "an instructor sees no invoices and only students of the groups he teaches / covers" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ2" "$B/api/fees?limit=5")/$(M "SELECT COUNT(*) FROM Student s WHERE s.id IN ($TSIDS) AND NOT EXISTS (SELECT 1 FROM StudentEnrollment e WHERE e.studentId=s.id AND (e.classSectionId IN (SELECT o.classSectionId FROM SubjectOffering o JOIN Teacher t ON t.id=o.teacherId WHERE t.userId='$TCHU') OR e.classSectionId IN (SELECT a.classSectionId FROM SubstituteAssignment a JOIN Teacher t ON t.id=a.substituteTeacherId WHERE t.userId='$TCHU' AND a.status IN ('CONFIRMED','PENDING_SUBSTITUTE_APPROVAL'))))")" "403/0"
check "the instructor sees his slip; switched off in Salary slips → settings, he does not" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ2" $B/api/teacher-portal/salary)/$(api PUT /api/accountant/salary-slips/settings '{"teacherSeesOwnSlips":false}' | jq_ "d['data']['teacherSeesOwnSlips']")/$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ2" $B/api/teacher-portal/salary)" "200/False/403"
# finished group: visible 30 days (final marks), then its students disappear (owner 2026-10-24)
GG=$(M "SELECT o.classSectionId FROM SubjectOffering o JOIN Teacher t ON t.id=o.teacherId JOIN StudentEnrollment e ON e.classSectionId=o.classSectionId AND e.status='ACTIVE' WHERE t.userId='$TCHU' AND NOT EXISTS (SELECT 1 FROM StudentEnrollment e2 JOIN SubjectOffering o3 ON o3.classSectionId=e2.classSectionId AND o3.teacherId=t.id WHERE e2.studentId=e.studentId AND e2.classSectionId<>o.classSectionId) LIMIT 1")
if [ -n "$GG" ]; then
  GS=$(M "SELECT studentId FROM StudentEnrollment WHERE classSectionId='$GG' AND status='ACTIVE' LIMIT 1")
  GSTATUS=$(M "SELECT CONCAT(status,'|',IFNULL(completedAt,'')) FROM ClassSection WHERE id='$GG'")
  M "UPDATE ClassSection SET status='COMPLETED', completedAt=DATE_SUB(NOW(), INTERVAL 10 DAY) WHERE id='$GG'"
  sleep 31
  A10=$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ2" $B/api/students/$GS)
  M "UPDATE ClassSection SET completedAt=DATE_SUB(NOW(), INTERVAL 40 DAY) WHERE id='$GG'"
  sleep 31
  A40=$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ2" $B/api/students/$GS)
  api PUT /api/teachers/access/settings '{"finishedGroupDays":50}' >/dev/null
  A50=$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ2" $B/api/students/$GS)
  api PUT /api/teachers/access/settings '{"finishedGroupDays":30}' >/dev/null
  M "UPDATE ClassSection SET status='${GSTATUS%%|*}', completedAt=$( [ -n "${GSTATUS#*|}" ] && echo "'${GSTATUS#*|}'" || echo NULL ) WHERE id='$GG'"
  check "finished group: its student is still seen 10 days later (final marks), not after 30 days; setting 50 days shows him again" "$A10/$A40/$A50" "200/403/200"
else
  check "grace test found an instructor group with a student only there" "none" "found"
fi
api PUT /api/accountant/salary-slips/settings '{"teacherSeesOwnSlips":true}' >/dev/null
rm -f "$TJ2"
rm -f "$ACJ"
TJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ" 10.0.1.95 >/dev/null
check "instructors cannot see money accounts" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ" $B/api/treasury)" "403"
rm -f "$TJ"
check "account movements export to Excel" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$B/api/data/movements/export?format=xlsx")" "200"
echo "== 55. FIN-2 extra fees + platform fee (rules, own invoice, no double charge, consequences, pay first) and budgets"
FPL=$(api POST /api/fee-types '{"nameEn":"Platform fee","nameAr":"رسوم المنصة","amount":100,"frequency":"MONTHLY","isPlatform":true,"defaultMode":"REQUIRED","onUnpaid":"BLOCK_NEXT"}' | jq_ "d['data']['id']")
FKIT=$(api POST /api/fee-types '{"nameEn":"Robot kit","nameAr":"كيت روبوت","amount":300,"frequency":"ONCE","defaultMode":"OPTIONAL"}' | jq_ "d['data']['id']")
FG=$(M "SELECT id FROM ClassSection WHERE campusId='$CAMPUS' AND status='ACTIVE' AND levelId IS NOT NULL AND (maxStudents IS NULL OR maxStudents>30) ORDER BY createdAt DESC LIMIT 1")
FS1=$(mkstu Feeone 01077770081 '' ''); FS2=$(mkstu Feetwo 01077770082 '' '')
api POST /api/fee-types/$FPL/rules "{\"scopeType\":\"STUDENT\",\"scopeId\":\"$FS2\",\"mode\":\"EXEMPT\"}" >/dev/null
api POST /api/groups/$FG/students "{\"studentId\":\"$FS1\"}" >/dev/null
api POST /api/groups/$FG/students "{\"studentId\":\"$FS2\"}" >/dev/null
FINV=$(M "SELECT invoiceId FROM StudentFeeCharge WHERE studentId='$FS1' AND feeTypeId='$FPL'")
check "joining a group charges the required platform fee on its OWN invoice (no group → instructor % untouched)" "$(M "SELECT CONCAT(CAST(totalAmount AS DECIMAL(10,0)),'/',classSectionId IS NULL,'/',(SELECT COUNT(*) FROM FeeItem WHERE invoiceId='$FINV')) FROM FeeInvoice WHERE id='$FINV'")" "100/1/1"
check "the monthly invoice itself is unchanged (price only)" "$(M "SELECT COUNT(*) FROM FeeInvoice WHERE studentId='$FS1' AND classSectionId='$FG'")/$(M "SELECT CAST(subtotal AS DECIMAL(10,0)) = CAST(totalAmount + discount AS DECIMAL(10,0)) FROM FeeInvoice WHERE studentId='$FS1' AND classSectionId='$FG' LIMIT 1")" "1/1"
check "an exempt student (exception) is not charged" "$(M "SELECT COUNT(*) FROM StudentFeeCharge WHERE studentId='$FS2' AND feeTypeId='$FPL'")" "0"
api POST /api/groups/$FG/generate-invoices "{\"studentId\":\"$FS1\"}" >/dev/null
check "never twice for the same month" "$(M "SELECT COUNT(*) FROM StudentFeeCharge WHERE studentId='$FS1' AND feeTypeId='$FPL'")" "1"
check "an optional fee added by hand (kit, once) — and refused the second time" "$(api POST /api/students/$FS2/fees "{\"feeTypeId\":\"$FKIT\"}" | jq_ "d['success']")/$(api POST /api/students/$FS2/fees "{\"feeTypeId\":\"$FKIT\"}" | jq_ "d['success']")/$(api GET /api/students/$FS2/fees | jq_ "len(d['data'])")" "True/False/1"
M "UPDATE FeeInvoice SET dueDate = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE id='$FINV'"
check "unpaid platform fee past its due date → this student cannot move to the next month" "$(api GET /api/groups/$FG | jq_ "('$FS1' in d['data']['feeBlocked'], '$FS2' in d['data']['feeBlocked'])")" "(True, False)"
api PUT /api/fee-types/settings '{"payFirst":"FEES"}' >/dev/null
api POST /api/wallet/topups "{\"studentId\":\"$FS1\",\"amount\":100,\"method\":\"Cash\"}" >/dev/null
check "pay-first = fees: a 100 top-up pays the fee before the monthly price" "$(M "SELECT status FROM FeeInvoice WHERE id='$FINV'")/$(M "SELECT CAST(paidAmount AS DECIMAL(10,0)) FROM FeeInvoice WHERE studentId='$FS1' AND classSectionId='$FG' LIMIT 1")" "PAID/0"
check "paid → the block is lifted" "$(api GET /api/groups/$FG | jq_ "'$FS1' in d['data']['feeBlocked']")" "False"
api PUT /api/fee-types/settings '{"payFirst":"TUITION"}' >/dev/null
YM=$(cairo +%Y-%m); BY=${YM%-*}; BMO=$((10#${YM#*-}))
api PUT /api/budgets "{\"year\":$BY,\"month\":$BMO,\"campusId\":\"$CAMPUS\",\"categoryId\":\"$TCAT\",\"amount\":100}" >/dev/null
api POST /api/accountant/expenses "{\"title\":\"E2E rent again\",\"amount\":150,\"categoryId\":\"$TCAT\",\"date\":\"$(D 0)\",\"campusId\":\"$CAMPUS\",\"paymentSource\":\"Cash\"}" >/dev/null
check "budget vs actual: 150 spent of 100 → over (150%)" "$(api GET "/api/budgets?year=$BY&month=$BMO&campusId=$CAMPUS" | jq_ "[(float(r['budget']), float(r['actual']), r['pct'], r['status']) for r in d['data']['rows'] if r['categoryId']=='$TCAT']")" "[(100.0, 150.0, 150, 'OVER')]"
check "'your work today' warns about the budget" "$(api GET /api/today | jq_ "any(t['key']=='budgetOver' for t in d['data']['tasks'])")" "True"
check "a secretary cannot set fees or budgets" "$(secapi POST /api/fee-types '{"nameEn":"X fee","nameAr":"رسم","amount":1,"frequency":"ONCE"}' | jq_ "d['success']")/$(secapi PUT /api/budgets "{\"year\":$BY,\"month\":$BMO,\"campusId\":\"$CAMPUS\",\"categoryId\":\"$TCAT\",\"amount\":1}" | jq_ "d['success']")" "False/False"
echo "== 56. FIN-3 cash flow + forecast, where every pound went, bank reconciliation, category names in reports"
CF=$(api GET "/api/finance/cashflow?months=3")
check "cash flow: 3 months, this month last, in − out = net, forecast present" "$(echo "$CF" | jq_ "(len(d['data']['months']), d['data']['months'][-1]['month']=='$(cairo +%Y-%m)', all(abs(r['in']-r['out']-r['net'])<0.01 for r in d['data']['months']), 'balanceAfter' in d['data']['forecast'])")" "(3, True, True, True)"
check "transfers between our accounts are not counted as money in / out" "$(echo "$CF" | jq_ "any('TRANSFER' in r['byKind'] for r in d['data']['months'])")" "False"
WH=$(api GET "/api/finance/where?from=$(cairo +%Y-%m)-01&to=$(D 0)")
check "where every pound: kept = in − out, and free = balance − families' wallets" "$(echo "$WH" | jq_ "(abs(d['data']['totalIn']-d['data']['totalOut']-d['data']['kept'])<0.01, abs(d['data']['now']['balance']-d['data']['now']['prepaid']-d['data']['now']['free'])<0.01)")" "(True, True)"
check "expenses are split by the owner's category names (E2E Rent)" "$(echo "$WH" | jq_ "any(l.get('category')=='E2E Rent' and bool(l.get('categoryAr')) and l['amount']>=150 for l in d['data']['out'])")" "True"
check "a secretary cannot open cash flow / reconciliation" "$(secapi GET /api/finance/cashflow | jq_ "d['success']")/$(secapi GET /api/treasury/reconcile | jq_ "d['success']")" "False/False"
TRFN=$(M "SELECT number FROM MoneyTransfer WHERE id='$TTID'")
STM=$(mktemp --suffix=.csv)
printf 'Date,Description,Debit,Credit,Reference\n%s,Deposit from branch,,100.00,%s\n%s,Bank fees,15.00,,BF-1\n' "$(D 0)" "$TRFN" "$(D 0)" > "$STM"
RC=$(curl -s -b "$JAR" -F "accountId=$TBANK" -F "file=@$STM" $B/api/treasury/reconcile)
check "statement (debit / credit columns) read: the deposit matches the transfer, the bank fee is bank-only" "$(echo "$RC" | jq_ "(d['data']['lines'], [m['move']['kind'] for m in d['data']['matched']], [float(l['amount']) for l in d['data']['bankOnly']])")" "(2, ['TRANSFER'], [-15.0])"
MID=$(echo "$RC" | jq_ "d['data']['matched'][0]['move']['id']")
api POST /api/treasury/reconcile/confirm "{\"accountId\":\"$TBANK\",\"pairs\":[{\"moveId\":\"$MID\",\"bankRef\":\"$TRFN\"}]}" >/dev/null
check "confirmed → the movement carries the bank reference and the date it was matched" "$(M "SELECT CONCAT(reconciledAt IS NOT NULL,'/',bankRef='$TRFN') FROM MoneyMovement WHERE id='$MID'")" "1/1"
check "comparing the same statement again: already matched, nothing new" "$(curl -s -b "$JAR" -F "accountId=$TBANK" -F "file=@$STM" $B/api/treasury/reconcile | jq_ "(d['data']['already'], len(d['data']['matched']))")" "(1, 0)"
check "undo takes a match back" "$(api POST /api/treasury/reconcile/confirm "{\"accountId\":\"$TBANK\",\"undo\":\"$MID\"}" | jq_ "d['data']['undone']")/$(M "SELECT reconciledAt IS NULL FROM MoneyMovement WHERE id='$MID'")" "1/1"
rm -f "$STM"
check "'your work today' knows the new money tasks (no error)" "$(api GET /api/today | jq_ "d['success']")" "True"
echo "== 57. Lesson gates per session (homework / quiz before the next lesson), instructor opens for one student, voice homework"
M "UPDATE ClassSection SET currentCycleNumber=1 WHERE id='$LG'"
GLS=$(api GET /api/groups/$LG/lessons)
GED=$(echo "$GLS" | jq_ "d['data']['edition']['id']")
RF=$(echo "$GLS" | jq_ "d['data']['range']['from']"); RN=$((RF + 1))
echo "  (gate test: edition $GED, sessions $RF→$RN, range to $(echo "$GLS" | jq_ "d['data']['range']['to']"))"
GS1=$(M "SELECT id FROM CurriculumSession WHERE editionId='$GED' AND number=$RF")
check "a gate is saved on a published session (homework graded, at least 90%)" "$(api PUT /api/curriculum/sessions/$GS1/gate '{"gate":{"homework":"GRADED","minHomeworkPct":90}}' | jq_ "d['data']['gate']['homework']")/$(M "SELECT JSON_UNQUOTE(JSON_EXTRACT(gate,'$.minHomeworkPct')) FROM CurriculumSession WHERE id='$GS1'")" "GRADED/90"
check "a secretary cannot change lesson gates" "$(secapi PUT /api/curriculum/sessions/$GS1/gate '{"gate":{"content":true}}' | jq_ "d['success']")" "False"
GST=$(api GET "/api/groups/$LG/lessons/gate?session=$RF")
check "the instructor panel lists the student as not finished yet (homework below 90% / missing)" "$(echo "$GST" | jq_ "[(x['met'], bool(x['missing'])) for x in d['data']['students'] if x['studentId']=='$LK']")" "[(False, True)]"
api PUT /api/platform/settings '{"modules":{"lms":true}}' >/dev/null
api PATCH /api/groups/$LG/lessons "{\"sessionNumber\":$RN,\"action\":\"open\"}" >/dev/null
GKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); GKJ=$(mktemp); login_jar "$(echo "$GKR" | jq_ "d['data']['loginId']")" "$(echo "$GKR" | jq_ "d['data']['password']")" "$GKJ" 10.0.1.97
NEXTST() { curl -s -b "$GKJ" $B/api/lessons/my | jq_ "[(s['open'], bool(s.get('lockedReason'))) for g in d['data']['groups'] if g['group']['id']=='$LG' for s in g['sessions'] if s['number']==$RN]"; }
check "even opened for the whole group, the next lesson waits for THIS student, with the reason shown" "$(NEXTST)" "[(False, True)]"
api POST /api/groups/$LG/lessons/gate "{\"studentId\":\"$LK\",\"sessionNumber\":$RN,\"open\":true}" >/dev/null
check "the instructor opens it for this one student → open for him" "$(NEXTST)/$(M "SELECT COUNT(*) FROM StudentLessonUnlock WHERE classSectionId='$LG' AND studentId='$LK' AND sessionNumber=$RN")" "[(True, False)]/1"
check "taking it back → waits again" "$(api POST /api/groups/$LG/lessons/gate "{\"studentId\":\"$LK\",\"sessionNumber\":$RN,\"open\":false}" | jq_ "d['success']")/$(NEXTST)" "True/[(False, True)]"
api PATCH /api/groups/$LG/lessons "{\"sessionNumber\":$RN,\"action\":\"auto\"}" >/dev/null
rm -f "$GKJ"
LMSS=$(api GET /api/lessons/settings | jq_ "json.dumps(d['data']['settings'])")
api PUT /api/lessons/settings "{\"settings\":$(python -c "import json,sys;s=json.loads(sys.argv[1]);s['instructorStudentUnlock']=False;s['gateUngradedOpensAfterDays']=2;print(json.dumps(s))" "$LMSS")}" >/dev/null
check "LMS settings: opening for one student switched off → refused; late-grading days saved" "$(api POST /api/groups/$LG/lessons/gate "{\"studentId\":\"$LK\",\"sessionNumber\":$RN,\"open\":true}" | jq_ "d['success']")/$(api GET /api/lessons/settings | jq_ "d['data']['settings']['gateUngradedOpensAfterDays']")" "False/2"
api PUT /api/lessons/settings "{\"settings\":$LMSS}" >/dev/null
check "removing the gate clears it" "$(api PUT /api/curriculum/sessions/$GS1/gate '{"gate":null}' | jq_ "d['success']")/$(M "SELECT gate IS NULL FROM CurriculumSession WHERE id='$GS1'")" "True/1"
GDR=$(api POST /api/curriculum/levels/$CL "{\"copyFromId\":\"$GED\"}" | jq_ "d['data']['id']")
GDS=$(M "SELECT id FROM CurriculumSession WHERE editionId='$GDR' AND number=1")
check "voice recording is a homework hand-in type" "$(api POST /api/curriculum/sessions/$GDS/blocks '{"type":"ASSIGNMENT","titleEn":"Say it","data":{"kinds":["AUDIO","FILE"],"maxPoints":5}}' | jq_ "d['success']")/$(M "SELECT JSON_CONTAINS(data,'\"AUDIO\"','$.kinds') FROM CurriculumBlock WHERE sessionId='$GDS' AND titleEn='Say it'")" "True/1"
api DELETE /api/curriculum/editions/$GDR >/dev/null
echo "== 58. Change log (automatic, old → new), usage (visits / time / sign-ins), data health check"
ME=$(M "SELECT id FROM User WHERE email='$SA_EMAIL'")
OLDFN=$(M "SELECT firstName FROM Student WHERE id='$LK'")
api PATCH /api/students/$LK '{"firstName":"Auditname"}' >/dev/null
check "changing a student is logged by itself: who, and the old → new name" "$(api GET "/api/audit-log?type=Student&entityId=$LK&action=UPDATE" | jq_ "[(r['userId']=='$ME', r['changes']['changed'].get('firstName')) for r in d['data']['rows'] if isinstance(r['changes'], dict) and 'changed' in r['changes']][:1]")" "[(True, ['$OLDFN', 'Auditname'])]"
api PATCH /api/students/$LK "{\"firstName\":\"$OLDFN\"}" >/dev/null
check "each change is logged once (no doubles)" "$(M "SELECT COUNT(*) FROM (SELECT COUNT(*) c FROM AuditLog WHERE JSON_EXTRACT(changes,'$.auto')=true GROUP BY entityType, entityId, action, CAST(changes AS CHAR(1000)), timestamp HAVING c > 1) x")" "0"
check "passwords and tokens never reach the change log" "$(M "SELECT COUNT(*) FROM AuditLog WHERE changes LIKE '%passwordHash%' OR changes LIKE '%resetToken%'")" "0"
check "a secretary cannot read the change log, usage or data health" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/audit-log)/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/usage)/$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/api/data-health)" "403/403/403"
ACJ=$(mktemp); login_jar $ACCE E2eAcc12345 "$ACJ" 10.0.2.41
check "the accountant cannot read the change log by default (owner 2026-10-24)" "$(curl -s -o /dev/null -w '%{http_code}' -b "$ACJ" $B/api/audit-log)" "403"
rm -f "$ACJ"
TODAYC=$(D 0)
M "DELETE FROM UserActivityDay WHERE userId='$ME' AND day='$TODAYC'"
api POST /api/activity/ping >/dev/null
M "UPDATE UserActivityDay SET lastAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND) WHERE userId='$ME' AND day='$TODAYC'"
api POST /api/activity/ping >/dev/null
check "usage: first ping = 1 visit; a ping a minute later adds about a minute of active time" "$(M "SELECT CONCAT(visits,'/',activeSeconds BETWEEN 55 AND 65) FROM UserActivityDay WHERE userId='$ME' AND day='$TODAYC'")" "1/1"
M "UPDATE UserActivityDay SET lastAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 45 MINUTE) WHERE userId='$ME' AND day='$TODAYC'"
api POST /api/activity/ping >/dev/null
check "after 30+ minutes away the next ping is a new visit" "$(M "SELECT visits FROM UserActivityDay WHERE userId='$ME' AND day='$TODAYC'")" "2"
check "sign-ins are counted, and the usage report shows the person" "$(M "SELECT COUNT(*) FROM UserActivityDay WHERE logins > 0 AND day='$TODAYC'" | python -c "import sys;print(int(sys.stdin.read())>0)")/$(api GET "/api/usage?role=STAFF" | jq_ "any(p['userId']=='$ME' and p['visits']>=2 for p in d['data']['people'])")" "True/True"
DH=$(api GET /api/data-health)
check "data health: every check runs, and 'groups without a schedule' matches the database" "$(echo "$DH" | jq_ "len(d['data']['checks'])>=10")/$(echo "$DH" | jq_ "[c['count'] for c in d['data']['checks'] if c['key']=='groupNoSchedule'][0]")" "True/$(M "SELECT COUNT(*) FROM ClassSection WHERE status='ACTIVE' AND isActive=1 AND (scheduleSlots IS NULL OR JSON_LENGTH(scheduleSlots)=0)")"
echo "== 59. ID cards: print data, public check (valid / not valid), lost card → new code, settings, track colour, instructor in every place"
CARDS=$(api GET "/api/cards?kind=STUDENT&groupId=$LG")
KCODE=$(echo "$CARDS" | jq_ "[c['code'] for c in d['data'] if c['id']=='$LK'][0]")
check "student cards of a group: the student is there with a TN-QR code, and the code is saved" "$(echo "$KCODE" | cut -c1-6)/$(M "SELECT idCardQRCode='$KCODE' FROM Student WHERE id='$LK'")/$(M "SELECT COUNT(*)>0 FROM IdCardEvent WHERE subjectId='$LK' AND action='ISSUED'")" "TN-QR-/1/1"
check "a stranger (not signed in) only sees 'valid', not who it is" "$(curl -s "$B/api/card-check?code=$KCODE" | jq_ "(d['data']['state'], 'person' in d['data'])")" "('VALID', False)"
check "staff see the person; the scanned link (…/card/<code>) works like the code" "$(api GET "/api/card-check?code=$(python -c "import urllib.parse,sys;print(urllib.parse.quote('https://x.app/card/'+sys.argv[1],safe=''))" "$KCODE")" | jq_ "(d['data']['state'], d['data']['person']['href'])")" "('VALID', '/dashboard/students/$LK')"
check "the public check page opens without signing in" "$(curl -s -o /dev/null -w '%{http_code}' "$B/card/$KCODE")" "200"
KPAIR=$(M "SELECT CONCAT(g.B,' ',g.A) FROM _GuardianToStudent g JOIN Student s ON s.id=g.B JOIN Guardian gu ON gu.id=g.A JOIN User u ON u.id=gu.userId WHERE s.isActive=1 AND s.enrollmentStatus='ACTIVE' AND u.isActive=1 LIMIT 1")
KPS=${KPAIR% *}; KPG=${KPAIR#* }
KPR=$(api POST /api/students/$KPS/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$KPG\"}")
KPJ=$(mktemp); login_jar "$(echo "$KPR" | jq_ "d['data']['loginId']")" "$(echo "$KPR" | jq_ "d['data']['password']")" "$KPJ" 10.0.1.98
KTJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$KTJ" 10.0.1.99
check "a parent / instructor cannot print cards" "$(curl -s -o /dev/null -w '%{http_code}' -b "$KPJ" "$B/api/cards?kind=STUDENT&groupId=$LG")/$(curl -s -o /dev/null -w '%{http_code}' -b "$KTJ" "$B/api/cards?kind=STUDENT&groupId=$LG")" "403/403"
check "print log" "$(api POST /api/cards/printed "{\"cards\":[{\"kind\":\"STUDENT\",\"id\":\"$LK\",\"code\":\"$KCODE\"}]}" | jq_ "d['data']['logged']")/$(M "SELECT COUNT(*) FROM IdCardEvent WHERE subjectId='$LK' AND action='PRINTED'")" "1/1"
NCODE=$(secapi POST /api/cards/replace "{\"kind\":\"STUDENT\",\"id\":\"$LK\",\"reason\":\"lost\"}" | jq_ "d['data']['code']")
check "lost card (secretary): new code …-R2; the old card stops working, the new one works" "$NCODE/$(curl -s "$B/api/card-check?code=$KCODE" | jq_ "d['data']['state']")/$(curl -s "$B/api/card-check?code=$NCODE" | jq_ "d['data']['state']")" "$KCODE-R2/UNKNOWN/VALID"
check "history shows issued, printed and replaced (with the reason)" "$(api GET "/api/cards/history?kind=STUDENT&id=$LK" | jq_ "(sorted(set(h['action'] for h in d['data'])), [h['reason'] for h in d['data'] if h['action']=='REPLACED'])")" "(['ISSUED', 'PRINTED', 'REPLACED'], ['lost'])"
M "UPDATE Student SET enrollmentStatus='WITHDRAWN' WHERE id='$LK'"
check "a student who left → card not valid" "$(curl -s "$B/api/card-check?code=$NCODE" | jq_ "d['data']['state']")" "LEFT"
M "UPDATE Student SET enrollmentStatus='ACTIVE' WHERE id='$LK'"
check "card settings: a secretary cannot change them; the admin can" "$(secapi PUT /api/cards/settings '{"validityMonths":24}' | jq_ "d['success']")/$(api PUT /api/cards/settings '{"validityMonths":24}' | jq_ "d['data']['validityMonths']")" "False/24"
api PUT /api/cards/settings '{"validityMonths":12}' >/dev/null
KTRK=$(M "SELECT s.trackId FROM ClassSection c JOIN Level l ON l.id=c.levelId JOIN AcademicSubject s ON s.id=l.subjectId WHERE c.id='$LG'")
api PATCH /api/tracks/$KTRK '{"color":"#e11d48"}' >/dev/null
check "track colour is saved and printed on the card; a wrong colour is refused" "$(api GET "/api/cards?kind=STUDENT&ids=$LK" | jq_ "d['data'][0]['color']")/$(api PATCH /api/tracks/$KTRK '{"color":"red"}' | jq_ "d['success']")" "#e11d48/False"
SCARDS=$(api GET "/api/cards?kind=STAFF&campusId=$CAMPUS")
check "staff cards of a place: TN-STF codes" "$(echo "$SCARDS" | jq_ "len(d['data'])>0 and all(c['code'].startswith('TN-STF-') for c in d['data'])")" "True"
SC1=$(echo "$SCARDS" | jq_ "d['data'][0]['code']")
check "a staff card is checked too" "$(curl -s "$B/api/card-check?code=$SC1" | jq_ "(d['data']['state'], d['data']['kind'])")" "('VALID', 'STAFF')"
PCARD() { curl -s -b "$KPJ" "$B/api/cards/portal?studentId=$KPS" | jq_ "d['data'] and d['data']['code'][:6]"; }
check "parent sees the child's digital card" "$(PCARD)" "TN-QR-"
api PUT /api/cards/settings '{"digitalForParents":false}' >/dev/null
check "digital card switched off for parents → nothing shown" "$(PCARD)" "None"
api PUT /api/cards/settings '{"digitalForParents":true}' >/dev/null
rm -f "$KPJ" "$KTJ"
TNEW=$(api POST /api/teachers "{\"firstName\":\"Every\",\"lastName\":\"Where\",\"cnic\":\"29901011234599\",\"dateOfBirth\":\"1995-03-05T00:00:00Z\",\"gender\":\"MALE\",\"joiningDate\":\"$(D 0)T00:00:00Z\",\"designation\":\"Teacher\",\"phoneNumber\":\"01012345699\",\"email\":\"every@e2e.local\",\"address\":\"Main street 1\",\"city\":\"Hurghada\",\"emergencyContact\":\"01012345698\",\"campusId\":\"$CAMPUS\",\"password\":\"E2eEvery1234\",\"allLocations\":true}")
check "new instructor with 'works in every place' ticked" "$(echo "$TNEW" | jq_ "d['success']")/$(M "SELECT allLocations FROM User WHERE email='every@e2e.local'")" "True/1"
echo "== 60. Front desk issues parent / student portal passwords (owner decision 2026-10-23)"
SECU=$(M "SELECT id FROM User WHERE email='sec@e2e.local'")
api PUT /api/users/$SECU/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[]}" >/dev/null
PIN=$(M "SELECT id FROM Student WHERE campusId='$CAMPUS' AND isActive=1 LIMIT 1")
POUT=$(M "SELECT id FROM Student WHERE campusId<>'$CAMPUS' AND isActive=1 LIMIT 1")
check "secretary (students:update) issues a student portal password in her branch" "$(secapi POST /api/students/$PIN/portal-password '{"target":"student"}' | jq_ "d['success']")" "True"
check "…but not for a student of another place" "$(secapi POST /api/students/$POUT/portal-password '{"target":"student"}' | jq_ "d['success']")" "False"
TPJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TPJ" 10.0.1.97
check "an instructor cannot issue portal passwords" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TPJ" -X POST -H 'Content-Type: application/json' -d '{"target":"student"}' $B/api/students/$PIN/portal-password)" "403"
rm -f "$TPJ"
APPLY=$(curl -s -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.1.96' -d '{"firstName":"Laila","lastName":"Online","fullNameAr":"ليلى أحمد أونلاين","fatherName":"Ahmed Online","dateOfBirth":"2017-05-05","gender":"FEMALE","address":"Sheraton street, Hurghada","city":"Hurghada","phoneNumber":"01000000221","emergencyContact":"01000000222","guardianFirstName":"Ahmed","guardianLastName":"Online","guardianPhoneNumber":"01000000221","guardianRelationship":"Father","preferredCampusId":"","preferredShift":"","deliveryMode":"PHYSICAL","termsAccepted":true}' $B/api/admissions/apply)
check "online request (form sends no branch) is saved without a branch" "$(echo "$APPLY" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM AdmissionRequest WHERE firstName='Laila' AND lastName='Online' AND preferredCampusId IS NULL")" "True/1"
check "…and the branch secretary sees it in the pending list" "$(secapi GET '/api/admissions?status=PENDING&limit=50' | jq_ "any(r['firstName']=='Laila' for r in d['data'])")" "True"
echo "== 61. Online application rules (editable) + holidays told to families who join later (2026-10-24)"
check "application rules are public (no login) and start with the 7 default rules" "$(curl -s $B/api/admission-rules | jq_ "len(d['data']['items'])")" "7"
check "a secretary cannot change them" "$(secapi PUT /api/admission-rules '{"items":[{"en":"x","ar":"y"}]}' | jq_ "d['success']")" "False"
api PUT /api/admission-rules '{"items":[{"en":"Rule one","ar":"الشرط الأول"},{"en":"","ar":""}]}' >/dev/null
check "the admin edits them (empty lines dropped) and the public form reads the new rules" "$(curl -s $B/api/admission-rules | jq_ "(len(d['data']['items']), d['data']['items'][0]['en'])")" "(1, 'Rule one')"
check "saving no rule at all is refused" "$(api PUT /api/admission-rules '{"items":[]}' | jq_ "d['success']")" "False"
M "DELETE FROM AppSetting WHERE \`key\`='admission.rules'"
JG=$(M "SELECT id FROM ClassSection WHERE status='ACTIVE' AND isActive=1 AND levelId IS NOT NULL AND maxStudents IS NULL AND campusId='$CAMPUS' AND JSON_LENGTH(scheduleSlots)>0 LIMIT 1")
JDOW=$(M "SELECT JSON_EXTRACT(scheduleSlots,'\$[0].dayOfWeek') FROM ClassSection WHERE id='$JG'")
JDAY=""; for i in 8 9 10 11 12 13 14; do if [ "$(cairo +%w $i)" = "$JDOW" ]; then JDAY=$(D $i); break; fi; done
api POST /api/holidays "{\"date\":\"$JDAY\",\"name\":\"E2E joiner day\",\"campusId\":\"$CAMPUS\"}" >/dev/null
JS=$(mkstu Joiner 01000000331 Jparent 01000000332)
api POST /api/groups/$JG/students "{\"studentId\":\"$JS\"}" >/dev/null
check "a student who joins after a holiday was announced: the family is told (in Arabic too)" "$(M "SELECT COUNT(*)>0 FROM Notification n JOIN Guardian g ON g.userId=n.userId JOIN _GuardianToStudent gs ON gs.A=g.id WHERE gs.B='$JS' AND n.type='HOLIDAY' AND n.relatedId='$JG' AND n.messageAr LIKE '%اتأجلت%'")" "1"
M "DELETE FROM Holiday WHERE name='E2E joiner day'"
echo "== 62. A substitute opens and marks the session he covers (live test 2026-10-25)"
SUBT=$(M "SELECT t.id FROM Teacher t JOIN User u ON u.id=t.userId WHERE u.email='tch@e2e.local'")
SUBG=$(M "SELECT c.id FROM ClassSection c WHERE c.status='ACTIVE' AND c.isActive=1 AND c.levelId IS NOT NULL AND c.id NOT IN (SELECT classSectionId FROM SubjectOffering WHERE teacherId='$SUBT') AND c.id NOT IN (SELECT classSectionId FROM TeacherSectionAssignment WHERE teacherId='$SUBT') AND EXISTS (SELECT 1 FROM StudentEnrollment e WHERE e.classSectionId=c.id AND e.status='ACTIVE') ORDER BY c.createdAt LIMIT 1")
SUBO=$(M "SELECT id FROM Teacher WHERE id<>'$SUBT' ORDER BY createdAt LIMIT 1")
check "e2e data for the substitute check (a group he does not teach)" "$([ -n "$SUBG" ] && [ -n "$SUBO" ] && echo yes)" "yes"
M "INSERT INTO TeacherAbsence (id, teacherId, date, scope, classSectionId, reason, status, requestedAt) VALUES ('ta-e2e-62','$SUBO','$(D 0)','SINGLE_SESSION','$SUBG','e2e','APPROVED',NOW(3))"
M "INSERT INTO SubstituteAssignment (id, teacherAbsenceId, classSectionId, date, originalTeacherId, substituteTeacherId, status, assignedBy, assignedAt) VALUES ('sa-e2e-62','ta-e2e-62','$SUBG','$(D 0)','$SUBO','$SUBT','CONFIRMED','$SA_ID',NOW(3))"
SJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$SJ" 10.0.1.62
check "the covered group is in the substitute's attendance list (marked with the day)" "$(curl -s -b "$SJ" $B/api/teacher-portal/sections | jq_ "[s['coveringDates'] for s in d['data'] if s['id']=='$SUBG']")" "[['$(D 0)']]"
check "the substitute opens the roster on the covered day, not on another day" "$(code_with "$SJ" "/api/enrollment-attendance/roster?classSectionId=$SUBG&date=$(D 0)")/$(code_with "$SJ" "/api/enrollment-attendance/roster?classSectionId=$SUBG&date=$(D 1)")" "200/403"
SUBE=$(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$SUBG' AND status='ACTIVE' LIMIT 1")
check "the substitute saves the attendance of the covered session (counted for him)" "$(curl -s -b "$SJ" -X POST -H 'Content-Type: application/json' -d "{\"classSectionId\":\"$SUBG\",\"attendanceDate\":\"$(D 0)\",\"records\":[{\"studentEnrollmentId\":\"$SUBE\",\"status\":\"PRESENT\"}]}" $B/api/enrollment-attendance | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM EnrollmentAttendanceRecord WHERE studentEnrollmentId='$SUBE' AND markedByTeacherId='$SUBT' AND DATE(attendanceDate)='$(D 0)'")" "True/1"
rm -f "$SJ"
check "reconciliation: the session recorded by the substitute is not counted for the absent instructor → no 2nd deduction suggested" "$(api GET /api/reports/substitute-reconciliation | jq_ "[(r['deductionAlreadyExcluded'], r['suggestedDeductionAmount']) for r in d['data'] if r['id']=='sa-e2e-62']")" "[(True, None)]"
echo "== 63. Instructor pay statement (2026-10-26)"
PSM=$(cairo +%Y-%m)
PSU=$(M "SELECT userId FROM Teacher WHERE id='$SUBT'")
PSX=$(M "SELECT COUNT(*) FROM (SELECT e.classSectionId g, r.attendanceDate d FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId WHERE DATE_FORMAT(r.attendanceDate,'%Y-%m')='$PSM' AND e.classSectionId IN (SELECT classSectionId FROM SubjectOffering WHERE teacherId='$SUBT') AND (r.taughtByTeacherId='$SUBT' OR (r.taughtByTeacherId IS NULL AND r.markedByTeacherId='$SUBT')) UNION SELECT l.classSectionId, l.sessionDate FROM GroupSessionLog l WHERE l.status='HELD' AND l.taughtByTeacherId='$SUBT' AND DATE_FORMAT(l.sessionDate,'%Y-%m')='$PSM' AND l.classSectionId IN (SELECT classSectionId FROM SubjectOffering WHERE teacherId='$SUBT')) x")
M "DELETE FROM TeacherEmployment WHERE teacherId='$SUBT'"
PST=$(api GET "/api/teachers/$SUBT/pay-statement?month=$PSM")
check "statement counts the sessions he taught this month in his own groups (same as the attendance records)" "$(echo "$PST" | jq_ "(d['success'], d['data']['totals']['sessions'] == $PSX)")" "(True, True)"
M "INSERT INTO TeacherPayAdjustment (id, teacherId, classSectionId, amount, reason, createdBy, createdAt, substituteAssignmentId) VALUES ('tpa-e2e-63','$SUBT','$SUBG',100,'Covered a session (e2e)','$SA_ID',NOW(3),'sa-e2e-62')"
check "the group he covered as a substitute shows only the substitute bonus (no session / % / fixed pay)" "$(api GET "/api/teachers/$SUBT/pay-statement?month=$PSM" | jq_ "[(g['coveredOnly'], g['total'], g['sessionAmount']+g['percentAmount']+g['fixedAmount']) for g in d['data']['groups'] if g['id']=='$SUBG']")" "[(True, 100, 0)]"
check "one group only: the covered group alone, net 100" "$(api GET "/api/teachers/$SUBT/pay-statement?month=$PSM&groupId=$SUBG" | jq_ "(len(d['data']['groups']), d['data']['totals']['net'])")" "(1, 100)"
check "Excel export of the statement" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code} %{content_type}' "$B/api/teachers/$SUBT/pay-statement?month=$PSM&format=xlsx")" "200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
check "a wrong month is refused" "$(code_with "$JAR" "/api/teachers/$SUBT/pay-statement?month=October")" "400"
PJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$PJ" 10.0.1.63
api PUT /api/accountant/salary-slips/settings '{"teacherSeesOwnSlips":true}' >/dev/null
OTHER_T=$(M "SELECT id FROM Teacher WHERE id<>'$SUBT' LIMIT 1")
check "the instructor opens his own statement, not another instructor's" "$(code_with "$PJ" "/api/teachers/$PSU/pay-statement?month=$PSM")/$(code_with "$PJ" "/api/teachers/$OTHER_T/pay-statement?month=$PSM")" "200/403"
api PUT /api/accountant/salary-slips/settings '{"teacherSeesOwnSlips":false}' >/dev/null
check "…and not at all while slips are hidden from instructors" "$(code_with "$PJ" "/api/teachers/$PSU/pay-statement?month=$PSM")" "403"
api PUT /api/accountant/salary-slips/settings '{"teacherSeesOwnSlips":true}' >/dev/null
rm -f "$PJ"
check "a secretary (no salaries) cannot open a pay statement" "$(code_with "$SECJ" "/api/teachers/$SUBT/pay-statement?month=$PSM")" "403"
M "DELETE FROM TeacherPayAdjustment WHERE id='tpa-e2e-63'"
echo "== 64. Month close + monthly financial report (a03, 2026-10-26)"
LM=$(date -u -d "$(cairo +%Y-%m-01) -1 month" +%Y-%m); LMD="${LM}-15"
OTHERC=$(M "SELECT id FROM Campus WHERE id<>'$CAMPUS' AND isActive=1 ORDER BY createdAt LIMIT 1")
MCE=$(api POST /api/accountant/expenses "{\"title\":\"E2E closed-month rent\",\"amount\":400,\"category\":\"UTILITIES\",\"date\":\"$LMD\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['data']['id']")
MCO=$(api POST /api/accountant/expenses "{\"title\":\"E2E other-branch rent\",\"amount\":150,\"category\":\"UTILITIES\",\"date\":\"$LMD\",\"campusId\":\"$OTHERC\"}" | jq_ "d['data']['id']")
check "e2e data: expenses dated last month in two branches" "$([ -n "$MCE" ] && [ "$MCE" != "None" ] && [ -n "$MCO" ] && [ "$MCO" != "None" ] && echo yes)" "yes"
MCI=$(M "SELECT id FROM FeeInvoice WHERE status IN ('ISSUED','OVERDUE') AND paidAmount=0 AND totalAmount>5 AND classSectionId IN (SELECT id FROM ClassSection WHERE campusId='$CAMPUS') ORDER BY createdAt DESC LIMIT 1")
M "UPDATE FeeInvoice SET createdAt='$LMD 10:00:00' WHERE id='$MCI'"
MCAMT=$(M "SELECT totalAmount-paidAmount FROM FeeInvoice WHERE id='$MCI'")
api PUT /api/users/$(M "SELECT id FROM User WHERE email='$ACCE'")/places "{\"allLocations\":false,\"campusIds\":[\"$CAMPUS\"],\"groupIds\":[]}" >/dev/null
MCJ=$(mktemp); login_jar $ACCE E2eAcc12345 "$MCJ" 10.0.2.64
mcacc() { curl -s -b "$MCJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
check "the checklist before closing answers (things still waiting in that month)" "$(api GET "/api/month-close/pending?ym=$LM" | jq_ "d['success'] and isinstance(d['data']['total'], int)")" "True"
check "a secretary cannot close a month" "$(secapi POST /api/month-close "{\"ym\":\"$LM\"}" | jq_ "d['error']['code']")" "FORBIDDEN"
check "a branch accountant cannot close the whole company" "$(mcacc POST /api/month-close "{\"ym\":\"$LM\"}" | jq_ "d['error']['code']")" "FORBIDDEN"
check "this month (not over) cannot be closed" "$(api POST /api/month-close "{\"ym\":\"$(cairo +%Y-%m)\"}" | jq_ "d['success']")" "False"
check "the admin closes last month for the whole company (report saved with it)" "$(api POST /api/month-close "{\"ym\":\"$LM\"}" | jq_ "d['success']")/$(M "SELECT CONCAT(status,'/',snapshot IS NOT NULL) FROM MonthLock WHERE ym='$LM' AND scopeKey='ALL'")" "True/LOCKED/1"
check "closing it twice is refused" "$(api POST /api/month-close "{\"ym\":\"$LM\"}" | jq_ "d['error']['code']")" "CONFLICT"
check "editing an expense of the closed month -> 409 MONTH_LOCKED with the reason in Arabic" "$(api PATCH /api/accountant/expenses/$MCE '{"amount":450}' | PYTHONUTF8=1 jq_ "(d['error']['code'], '\u0645\u0642\u0641\u0648\u0644' in d['error']['message'])")/$(M "SELECT amount FROM Expense WHERE id='$MCE'")" "('MONTH_LOCKED', True)/400.00"
check "…deleting it is refused too" "$(api DELETE /api/accountant/expenses/$MCE | jq_ "d['error']['code']")/$(M "SELECT isDeleted FROM Expense WHERE id='$MCE'")" "MONTH_LOCKED/0"
check "…a note can still be added to it" "$(api PATCH /api/accountant/expenses/$MCE '{"notes":"receipt found"}' | jq_ "d['success']")" "True"
check "a new expense dated in the closed month is refused; dated today it is fine" "$(api POST /api/accountant/expenses "{\"title\":\"E2E back-dated\",\"amount\":10,\"category\":\"UTILITIES\",\"date\":\"$LMD\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['error']['code']")/$(api POST /api/accountant/expenses "{\"title\":\"E2E today expense\",\"amount\":10,\"category\":\"UTILITIES\",\"date\":\"$(D 0)\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['success']")" "MONTH_LOCKED/True"
check "a payment back-dated into the closed month is refused" "$(api POST /api/accountant/fees/invoices/$MCI/payments "{\"amount\":$MCAMT,\"paymentMethod\":\"InstaPay\",\"paymentDate\":\"${LMD}T10:00:00.000Z\"}" | jq_ "d['error']['code']")" "MONTH_LOCKED"
check "cancelling an invoice made in the closed month is refused" "$(api PATCH /api/fees/$MCI '{"status":"CANCELLED"}' | jq_ "d['error']['code']")" "MONTH_LOCKED"
check "a late payment today on last month's invoice is recorded (in this month)" "$(api POST /api/fees/$MCI/payments "{\"amount\":$MCAMT,\"paymentMethod\":\"InstaPay\"}" | jq_ "d['success']")/$(M "SELECT DATE_FORMAT(CONVERT_TZ(MAX(paymentDate),'+00:00','+03:00'),'%Y-%m')>='$(cairo +%Y-%m)' FROM FeePayment WHERE invoiceId='$MCI'")" "True/1"
MCR=$(api GET "/api/month-close/report?ym=$LM")
check "the monthly report of a closed month is the saved copy" "$(echo "$MCR" | jq_ "(d['data']['frozen'], d['data']['report']['ym'])")" "(True, '$LM')"
check "…its expenses include the closed-month rent, and profit = net income - expenses - salaries" "$(echo "$MCR" | jq_ "(d['data']['report']['totals']['expenses'] >= 550, abs(d['data']['report']['totals']['profit'] - (d['data']['report']['totals']['netIncome'] - d['data']['report']['totals']['expenses'] - d['data']['report']['totals']['salaries'])) < 0.01)")" "(True, True)"
check "live numbers on request; Excel download" "$(api GET "/api/month-close/report?ym=$LM&live=1" | jq_ "d['data']['frozen']")/$(curl -s -b "$JAR" -o /dev/null -w '%{http_code} %{content_type}' "$B/api/month-close/report?ym=$LM&format=xlsx")" "False/200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
check "the branch accountant sees his branch report, not the company one; a secretary sees none" "$(code_with "$MCJ" "/api/month-close/report?ym=$LM&campusId=$CAMPUS")/$(code_with "$MCJ" "/api/month-close/report?ym=$LM")/$(code_with "$SECJ" "/api/month-close/report?ym=$LM&campusId=$CAMPUS")" "200/403/403"
check "the months list shows the branch as closed by the company close" "$(mcacc GET /api/month-close | jq_ "[(r['status'], r['byCompany']) for r in d['data']['rows'] if r['ym']=='$LM' and r['campusId']=='$CAMPUS']")" "[('LOCKED', True)]"
check "the accountant cannot reopen; reopening without a reason is refused" "$(mcacc POST /api/month-close/reopen "{\"ym\":\"$LM\",\"reason\":\"mistake found\"}" | jq_ "d['error']['code']")/$(api POST /api/month-close/reopen "{\"ym\":\"$LM\",\"reason\":\"x\"}" | jq_ "d['success']")" "FORBIDDEN/False"
check "the Super Admin reopens with a reason (kept in the history)" "$(api POST /api/month-close/reopen "{\"ym\":\"$LM\",\"reason\":\"E2E correction of rent\"}" | jq_ "d['success']")/$(api GET "/api/month-close/history?ym=$LM" | jq_ "[e['action'] for e in d['data']][:2]")" "True/['REOPEN', 'LOCK']"
check "after reopening the expense can be changed again" "$(api PATCH /api/accountant/expenses/$MCE '{"amount":420}' | jq_ "d['success']")" "True"
check "the branch accountant closes last month for his branch only" "$(mcacc POST /api/month-close "{\"ym\":\"$LM\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['success']")" "True"
check "…his branch's expense is closed, the other branch's is not" "$(api PATCH /api/accountant/expenses/$MCE '{"amount":430}' | jq_ "d['error']['code']")/$(api PATCH /api/accountant/expenses/$MCO '{"amount":160}' | jq_ "d['success']")" "MONTH_LOCKED/True"
api POST /api/month-close/reopen "{\"ym\":\"$LM\",\"campusId\":\"$CAMPUS\",\"reason\":\"E2E reopen branch\"}" >/dev/null
check "settings: a secretary cannot change them; the admin turns the automatic close on" "$(secapi PUT /api/month-close/settings '{"autoLock":true}' | jq_ "d['success']")/$(api PUT /api/month-close/settings '{"autoLock":true,"autoLockDay":1,"remindDay":1}' | jq_ "d['data']['autoLock']")" "False/True"
M "DELETE FROM MonthLock WHERE ym='$LM'"
MCP=$(api GET "/api/month-close/pending?ym=$LM" | jq_ "d['data']['total']")
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
MCA=$(M "SELECT CONCAT(status,'/',auto) FROM MonthLock WHERE ym='$LM' AND scopeKey='ALL'")
check "the daily job closes last month automatically only when nothing is waiting" "$([ "$MCP" = "0" ] && echo "$MCA" || echo "waiting:$MCA")" "$([ "$MCP" = "0" ] && echo "LOCKED/1" || echo "waiting:")"
M "DELETE FROM MonthLock WHERE ym='$LM'"
M "INSERT INTO MonthLock (id, ym, scopeKey, status, lockedAt, createdAt, updatedAt) VALUES ('ml-e2e-64','$LM','ALL','OPEN',NOW(3),NOW(3),NOW(3))"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "a month a Super Admin reopened is never closed again by the job" "$(M "SELECT COUNT(*) FROM MonthLock WHERE ym='$LM' AND status='LOCKED'")" "0"
PLS=$(api POST /api/accountant/profit-loss "{\"periodLabel\":\"E2E PL $LM\",\"periodStart\":\"${LM}-01T00:00:00.000Z\",\"periodEnd\":\"${LMD}T23:59:59.000Z\",\"profitPercentage\":10}")
PLID=$(echo "$PLS" | jq_ "d['data']['id']"); PLA=$(echo "$PLS" | jq_ "d['data']['totalIncome']")
PLR=$(api POST /api/accountant/profit-loss/$PLID/regenerate | jq_ "d['data']['totalIncome']")
check "P&L: a statement and its regenerate give the same income (refunds taken off in both)" "$([ -n "$PLA" ] && [ "$PLA" != "None" ] && [ "$PLA" = "$PLR" ] && echo same || echo "$PLA vs $PLR")" "same"
api PUT /api/month-close/settings '{"autoLock":false,"autoLockDay":5,"remindDay":3}' >/dev/null
M "DELETE FROM MonthLock WHERE ym='$LM'; DELETE FROM MonthLockEvent WHERE ym='$LM'"
rm -f "$MCJ"
echo "== 65. Teaching modes M1 batch 1: allowed ways, where offered, standalone course, online place (a02, 2026-10-30)"
DLV=$(M "SELECT l.id FROM Level l JOIN AcademicSubject s ON s.id=l.subjectId WHERE s.trackId IS NOT NULL AND s.isActive=1 ORDER BY l.createdAt LIMIT 1")
DCR=$(M "SELECT subjectId FROM Level WHERE id='$DLV'")
DTR=$(M "SELECT trackId FROM AcademicSubject WHERE id='$DCR'")
DOTHER=$(M "SELECT id FROM Campus WHERE id<>'$CAMPUS' AND isActive=1 ORDER BY createdAt LIMIT 1")
check "e2e data: a level with its course and track, and a second place" "$([ -n "$DLV" ] && [ -n "$DTR" ] && [ -n "$DOTHER" ] && echo yes)" "yes"
check "nothing set = every way allowed" "$(api GET "/api/delivery/catalog?kind=LEVEL&id=$DLV" | jq_ "(d['data']['effective']['modes'], d['data']['effective']['from'])")" "(['BRANCH', 'ONLINE', 'RECORDED'], 'DEFAULT')"
check "the course allows branch + online only" "$(api PUT /api/delivery/catalog "{\"kind\":\"COURSE\",\"id\":\"$DCR\",\"allowedModes\":[\"ONLINE\",\"BRANCH\"],\"offeredIn\":[]}" | jq_ "d['data']['effective']['modes']")" "['BRANCH', 'ONLINE']"
check "…its level inherits it (from the course)" "$(api GET "/api/delivery/catalog?kind=LEVEL&id=$DLV" | jq_ "(d['data']['allowedModes'], d['data']['inherited']['from'], d['data']['effective']['modes'])")" "(None, 'COURSE', ['BRANCH', 'ONLINE'])"
check "…the level can narrow it again (the closest wins)" "$(api PUT /api/delivery/catalog "{\"kind\":\"LEVEL\",\"id\":\"$DLV\",\"allowedModes\":[\"RECORDED\"],\"offeredIn\":[]}" | jq_ "(d['data']['effective']['modes'], d['data']['effective']['from'])")" "(['RECORDED'], 'LEVEL')"
DTJ=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$DTJ" 10.0.2.65
check "an instructor cannot change the catalog settings" "$(curl -s -b "$DTJ" -X PUT -H 'Content-Type: application/json' -d "{\"kind\":\"COURSE\",\"id\":\"$DCR\",\"allowedModes\":null,\"offeredIn\":[]}" $B/api/delivery/catalog | jq_ "d['success']")" "False"
rm -f "$DTJ"
api PUT /api/delivery/catalog "{\"kind\":\"LEVEL\",\"id\":\"$DLV\",\"allowedModes\":null,\"offeredIn\":[\"$DOTHER\"]}" >/dev/null
check "a level offered in one place only: listed there, not in the other place" "$(api GET "/api/levels?subjectId=$DCR&campusId=$DOTHER" | jq_ "any(l['id']=='$DLV' for l in d['data'])")/$(api GET "/api/levels?subjectId=$DCR&campusId=$CAMPUS" | jq_ "any(l['id']=='$DLV' for l in d['data'])")/$(api GET "/api/levels?subjectId=$DCR" | jq_ "any(l['id']=='$DLV' for l in d['data'])")" "True/False/True"
check "…a group of that level cannot be made in the other place (409 NOT_OFFERED)" "$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"batchId\":\"$BATCH\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E Not Offered\",\"sectionName\":\"N\",\"levelId\":\"$DLV\"}" | jq_ "d['error']['code']")" "NOT_OFFERED"
api PUT /api/delivery/catalog "{\"kind\":\"TRACK\",\"id\":\"$DTR\",\"allowedModes\":null,\"offeredIn\":[\"$DOTHER\"]}" >/dev/null
check "a track for one partner / place only: its courses disappear from the other place's lists" "$(api GET "/api/tracks?campusId=$CAMPUS" | jq_ "any(t['id']=='$DTR' for t in d['data'])")/$(api GET "/api/academic-subjects?campusId=$CAMPUS" | jq_ "any(c['id']=='$DCR' for c in d['data'])")/$(api GET "/api/academic-subjects?campusId=$DOTHER" | jq_ "any(c['id']=='$DCR' for c in d['data'])")" "False/False/True"
api PUT /api/delivery/catalog "{\"kind\":\"TRACK\",\"id\":\"$DTR\",\"allowedModes\":null,\"offeredIn\":[]}" >/dev/null
api PUT /api/delivery/catalog "{\"kind\":\"LEVEL\",\"id\":\"$DLV\",\"allowedModes\":null,\"offeredIn\":[]}" >/dev/null
api PUT /api/delivery/catalog "{\"kind\":\"COURSE\",\"id\":\"$DCR\",\"allowedModes\":null,\"offeredIn\":[]}" >/dev/null
check "cleared again: offered everywhere, every way" "$(api GET "/api/levels?subjectId=$DCR&campusId=$CAMPUS" | jq_ "any(l['id']=='$DLV' for l in d['data'])")/$(M "SELECT COUNT(*) FROM OfferedIn")/$(api GET "/api/delivery/catalog?kind=LEVEL&id=$DLV" | jq_ "d['data']['effective']['from']")" "True/0/DEFAULT"
SAC=$(api POST /api/academic-subjects '{"name":"E2E Summer Workshop","code":"E2EWS"}' | jq_ "d['data']['id']")
api POST /api/levels "{\"subjectId\":\"$SAC\",\"name\":\"Workshop\",\"order\":1,\"numberOfMonths\":1,\"numberOfSessions\":4,\"pricingType\":\"FULL_LEVEL\",\"fullLevelPrice\":500}" >/dev/null
SAL=$(M "SELECT id FROM Level WHERE subjectId='$SAC'")
check "a standalone course (no track) with its level can have a group" "$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"batchId\":\"$BATCH\",\"shiftId\":\"$SHIFT\",\"className\":\"E2E Workshop\",\"sectionName\":\"W\",\"levelId\":\"$SAL\"}" | jq_ "d['success']")/$(M "SELECT trackId IS NULL FROM AcademicSubject WHERE id='$SAC'")" "True/1"
check "a secretary cannot make the online place" "$(secapi POST /api/campuses/online | jq_ "d['success']")" "False"
ONP=$(api POST /api/campuses/online | jq_ "d['data']['id']")
check "the Super Admin makes the ONE online place (asking again returns the same one)" "$(M "SELECT kind FROM Campus WHERE id='$ONP'")/$(api POST /api/campuses/online | jq_ "d['data']['id']=='$ONP'")/$(M "SELECT COUNT(*) FROM Campus WHERE kind='ONLINE'")" "ONLINE/True/1"
check "…and it is listed with the places" "$(api GET /api/campuses | jq_ "any(c['id']=='$ONP' for c in d['data'])")" "True"
echo "== 66. Programmes on each branch / partner page (same 'where offered' data, 2026-10-30)"
check "the place's programmes list shows the track, offered everywhere" "$(api GET /api/places/$CAMPUS/catalog | jq_ "[(t['scope'], t['offered']) for t in d['data'] if t['id']=='$DTR']")" "[('EVERYWHERE', True)]"
check "unticking it on one branch keeps it for every other place" "$(api PUT /api/places/$CAMPUS/catalog "{\"kind\":\"TRACK\",\"id\":\"$DTR\",\"on\":false}" | jq_ "[t['scope'] for t in d['data'] if t['id']=='$DTR']")/$(api GET "/api/tracks?campusId=$CAMPUS" | jq_ "any(t['id']=='$DTR' for t in d['data'])")/$(api GET "/api/tracks?campusId=$DOTHER" | jq_ "any(t['id']=='$DTR' for t in d['data'])")" "['NOT_HERE']/False/True"
check "…and Course Structure shows the same places" "$(api GET "/api/delivery/catalog?kind=TRACK&id=$DTR" | jq_ "('$CAMPUS' not in d['data']['offeredIn'], '$DOTHER' in d['data']['offeredIn'])")" "(True, True)"
check "ticking it again offers it there again" "$(api PUT /api/places/$CAMPUS/catalog "{\"kind\":\"TRACK\",\"id\":\"$DTR\",\"on\":true}" | jq_ "[(t['scope'], t['offered']) for t in d['data'] if t['id']=='$DTR']")" "[('HERE', True)]"
api PUT /api/delivery/catalog "{\"kind\":\"LEVEL\",\"id\":\"$DLV\",\"allowedModes\":null,\"offeredIn\":[\"$DOTHER\"]}" >/dev/null
check "unticking the only place left closes it everywhere (never 'everywhere' by mistake)" "$(api PUT /api/places/$DOTHER/catalog "{\"kind\":\"LEVEL\",\"id\":\"$DLV\",\"on\":false}" >/dev/null; M "SELECT GROUP_CONCAT(campusId) FROM OfferedIn WHERE entityId='$DLV'")/$(api GET "/api/levels?subjectId=$DCR&campusId=$DOTHER" | jq_ "any(l['id']=='$DLV' for l in d['data'])")" "NONE/False"
check "a branch secretary cannot change another place's programmes" "$(secapi PUT /api/places/$DOTHER/catalog "{\"kind\":\"TRACK\",\"id\":\"$DTR\",\"on\":false}" | jq_ "d['success']")" "False"
check "standalone courses are listed on the place page too (top level, with their level)" "$(api GET /api/places/$CAMPUS/catalog | jq_ "[(c['kind'], len(c['children'])) for c in d['data'] if c['id']=='$SAC']")" "[('COURSE', 1)]"
M "DELETE FROM OfferedIn"
echo "== 67. Codes filled in automatically, still changeable (owner 2026-10-30)"
AC1=$(api POST /api/academic-subjects '{"name":"E2E Python For Kids"}' | jq_ "d['data']['code']")
AC2=$(api POST /api/academic-subjects '{"name":"E2E Python For Kids Two"}' | jq_ "d['data']['code']")
check "a course with no code gets one from its name; the next one never repeats it" "$AC1/$AC2" "EPFK/EPFK2"
check "a code typed by hand is kept" "$(api POST /api/academic-subjects '{"name":"E2E Hand Code","code":"zz9"}' | jq_ "d['data']['code']")" "ZZ9"
check "a code already used is refused with a clear message (not an error page)" "$(api POST /api/academic-subjects "{\"name\":\"E2E Clash\",\"code\":\"$AC1\"}" | jq_ "(d['error']['code'], 'used' in d['error']['message'])")" "('CONFLICT', True)"
echo "== 68. Several curricula per level + copy for a partner / place (a02, 2026-10-31)"
CVL=$(M "SELECT e.levelId FROM CurriculumEdition e JOIN Level l ON l.id=e.levelId WHERE e.status='PUBLISHED' AND e.variantId IS NULL AND l.isActive=1 ORDER BY e.createdAt LIMIT 1")
CVE=$(M "SELECT id FROM CurriculumEdition WHERE levelId='$CVL' AND status='PUBLISHED' AND variantId IS NULL ORDER BY number DESC LIMIT 1")
check "e2e data: a level with a published main curriculum" "$([ -n "$CVL" ] && [ -n "$CVE" ] && echo yes)" "yes"
VPA=$(api POST /api/curriculum/variants "{\"levelId\":\"$CVL\",\"name\":\"E2E Partner curriculum\",\"campusIds\":[\"$DOTHER\"]}" | jq_ "d['data']['id']")
VON=$(api POST /api/curriculum/variants "{\"levelId\":\"$CVL\",\"name\":\"E2E Online curriculum\",\"modes\":[\"ONLINE\"]}" | jq_ "d['data']['id']")
check "another curriculum for a place and one for the online way" "$([ -n "$VPA" ] && [ "$VPA" != "None" ] && [ -n "$VON" ] && [ "$VON" != "None" ] && echo yes)" "yes"
VPE=$(api POST /api/curriculum/levels/$CVL "{\"copyFromId\":\"$CVE\",\"variantId\":\"$VPA\"}" | jq_ "d['data']['id']")
api PATCH /api/curriculum/editions/$VPE '{"action":"publish"}' >/dev/null
check "publishing the partner curriculum does not archive the main one" "$(M "SELECT status FROM CurriculumEdition WHERE id='$VPE'")/$(M "SELECT status FROM CurriculumEdition WHERE id='$CVE'")" "PUBLISHED/PUBLISHED"
CVG=$(api POST /api/groups "{\"campusId\":\"$DOTHER\",\"className\":\"E2E Curriculum Group\",\"sectionName\":\"C\",\"levelId\":\"$CVL\"}" | jq_ "d['data']['id']")
check "a new group in the partner's place reads the partner curriculum" "$(api GET /api/groups/$CVG/curriculum | jq_ "(d['data']['reads']['id']=='$VPA', d['data']['canChange'], len(d['data']['options']))")" "(True, True, 2)"
check "…its lessons come from the partner curriculum" "$(api GET "/api/groups/$CVG/lessons" | jq_ "d['data']['edition']['id']=='$VPE'")" "True"
api PATCH /api/groups/$CVG '{"curriculumVariantId":"MAIN"}' >/dev/null
check "before its first session the group can switch to the main curriculum" "$(api GET /api/groups/$CVG/curriculum | jq_ "(d['data']['chosen'], d['data']['reads'])")" "('MAIN', None)"
STG=$(M "SELECT id FROM ClassSection WHERE levelId='$CVL' AND startDate IS NOT NULL LIMIT 1")
check "a group that has started keeps its curriculum (409)" "$([ -z "$STG" ] && echo GROUP_STARTED || api PATCH /api/groups/$STG "{\"curriculumVariantId\":\"$VPA\"}" | jq_ "d['error']['code']")" "GROUP_STARTED"
api PUT /api/places/$CAMPUS/catalog "{\"kind\":\"LEVEL\",\"id\":\"$CVL\",\"curriculumId\":\"$VON\"}" >/dev/null
check "from a branch page: this branch uses the online curriculum for the level" "$(api GET /api/places/$CAMPUS/catalog | python -c "import sys,json;d=json.load(sys.stdin)['data'];f=lambda xs:[y for x in xs for y in ([x]+f(x['children']))];print([l['curriculumHere']=='$VON' for l in f(d) if l['id']=='$CVL'])")/$(M "SELECT JSON_CONTAINS(campusIds, '\"$CAMPUS\"') FROM CurriculumVariant WHERE id='$VON'")" "[True]/1"
check "a curriculum with versions cannot be removed" "$(api DELETE /api/curriculum/variants/$VPA | jq_ "d['error']['code']")" "IN_USE"
CPY=$(api POST /api/delivery/copy "{\"kind\":\"LEVEL\",\"id\":\"$CVL\",\"campusIds\":[\"$DOTHER\"],\"numberOfSessions\":13,\"closeOriginalThere\":true}" | jq_ "d['data']['id']")
check "copy a level for a partner with 13 sessions: offered there only, original closed there, curriculum copied as a draft" "$(M "SELECT numberOfSessions FROM Level WHERE id='$CPY'")/$(M "SELECT GROUP_CONCAT(campusId) FROM OfferedIn WHERE entityId='$CPY'")/$(api GET "/api/levels?subjectId=$(M "SELECT subjectId FROM Level WHERE id='$CVL'")&campusId=$DOTHER" | jq_ "('$CPY' in [l['id'] for l in d['data']], '$CVL' in [l['id'] for l in d['data']])")/$(M "SELECT status FROM CurriculumEdition WHERE levelId='$CPY'")" "13/$DOTHER/(True, False)/DRAFT"
CVC=$(M "SELECT subjectId FROM Level WHERE id='$CVL'")
CPC=$(api POST /api/delivery/copy "{\"kind\":\"COURSE\",\"id\":\"$CVC\",\"campusIds\":[\"$DOTHER\"],\"closeOriginalThere\":false}" | jq_ "d['data']['id']")
NLV=$(M "SELECT COUNT(*) FROM Level WHERE subjectId='$CVC' AND isActive=1")
check "copy a whole course: same levels, code filled in, curricula copied (published)" "$(M "SELECT COUNT(*) FROM Level WHERE subjectId='$CPC'")/$(M "SELECT code<>'' FROM AcademicSubject WHERE id='$CPC'")/$(M "SELECT COUNT(*)>0 FROM CurriculumEdition e JOIN Level l ON l.id=e.levelId WHERE l.subjectId='$CPC' AND e.status='PUBLISHED'")" "$NLV/1/1"
check "copying needs a signed-in person" "$(curl -s -o /dev/null -w '%{http_code}' -b "$(mktemp)" -X POST $B/api/delivery/copy)" "401"
M "DELETE FROM OfferedIn"
echo "== 69. Templates of ways + a way for every session (a02 batch 2, 2026-10-31)"
TPL=$(api POST /api/delivery/templates '{"name":"E2E Hybrid 1+1","nameAr":"هايبرد 1+1","pattern":["ONLINE","BRANCH"]}' | jq_ "d['data']['id']")
check "a template of ways is added" "$(api GET /api/delivery/templates | jq_ "[t['pattern'] for t in d['data'] if t['id']=='$TPL']")" "[['ONLINE', 'BRANCH']]"
check "the level gets it as default template" "$(api PUT /api/delivery/catalog "{\"kind\":\"LEVEL\",\"id\":\"$CVL\",\"allowedModes\":null,\"offeredIn\":[],\"templateId\":\"$TPL\"}" | jq_ "d['data']['templateId']=='$TPL'")" "True"
SUN=""; TUE=""; for i in 1 2 3 4 5 6 7; do [ "$(cairo +%w $i)" = "0" ] && SUN=$(D $i); [ "$(cairo +%w $i)" = "2" ] && TUE=$(D $i); done
check "e2e data: next Sunday and Tuesday" "$([ -n "$SUN" ] && [ -n "$TUE" ] && echo yes)" "yes"
check "group schedule with a way per slot (Sun online, Tue branch)" "$(api PATCH /api/groups/$CVG "{\"scheduleSlots\":[{\"dayOfWeek\":0,\"time\":\"16:00\",\"mode\":\"ONLINE\"},{\"dayOfWeek\":2,\"time\":\"18:00\",\"mode\":\"BRANCH\"}],\"deliveryTemplateId\":\"$TPL\"}" | jq_ "d['success']")/$(M "SELECT JSON_EXTRACT(scheduleSlots,'\$[0].mode') FROM ClassSection WHERE id='$CVG'")" 'True/"ONLINE"'
api PUT /api/delivery/catalog "{\"kind\":\"LEVEL\",\"id\":\"$CVL\",\"allowedModes\":[\"BRANCH\"],\"offeredIn\":[],\"templateId\":\"$TPL\"}" >/dev/null
check "a way the level does not allow is refused (409)" "$(api PATCH /api/groups/$CVG '{"scheduleSlots":[{"dayOfWeek":0,"time":"16:00","mode":"ONLINE"}]}' | jq_ "d['error']['code']")" "MODE_NOT_ALLOWED"
api PUT /api/delivery/catalog "{\"kind\":\"LEVEL\",\"id\":\"$CVL\",\"allowedModes\":null,\"offeredIn\":[],\"templateId\":null}" >/dev/null
SCH=$(api GET "/api/groups/schedule?from=$(D 1)&to=$(D 8)")
check "the calendar shows each session's way" "$(echo "$SCH" | jq_ "sorted(set((o['date'], o['mode']) for o in d['data']['sessions'] if o['groupId']=='$CVG' and o['date'] in ('$SUN', '$TUE')))")" "$(python -c "print(sorted([('$SUN','ONLINE'),('$TUE','BRANCH')]))")"
MST=$(mkstu Modeboy 01000000691 Modeparent 01000000692)
api POST /api/groups/$CVG/students "{\"studentId\":\"$MST\"}" >/dev/null
check "one session of the group moved online: calendar + families told (Arabic too)" "$(api POST /api/groups/$CVG/session-mode "{\"date\":\"$TUE\",\"mode\":\"ONLINE\",\"note\":\"E2E\"}" | jq_ "d['success']")/$(api GET "/api/groups/schedule?from=$TUE&to=$TUE" | jq_ "[o['mode'] for o in d['data']['sessions'] if o['groupId']=='$CVG']")/$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='SESSION_MODE' AND relatedId='$CVG' AND messageAr LIKE '%أونلاين%'")" "True/['ONLINE']/1"
api POST /api/groups/$CVG/session-mode "{\"date\":\"$TUE\",\"mode\":null}" >/dev/null
check "one student attends Tuesday online: the attendance screen shows it" "$(api POST /api/groups/$CVG/session-mode "{\"date\":\"$TUE\",\"mode\":\"ONLINE\",\"studentId\":\"$MST\"}" | jq_ "d['success']")/$(api GET "/api/enrollment-attendance/roster?classSectionId=$CVG&date=$TUE" | jq_ "(d['data']['sessionMode'], [e['attendsAs'] for e in d['data']['enrollments'] if e['student']['id']=='$MST'])")" "True/('BRANCH', ['ONLINE'])"
check "…and the student's next sessions show that one as online" "$(api GET /api/students/$MST/upcoming-sessions | jq_ "[s['mode'] for s in d['data']['sessions'] if s['date']=='$TUE']")" "['ONLINE']"
api POST /api/holidays "{\"date\":\"$SUN\",\"name\":\"E2E branch day off\",\"campusId\":\"$DOTHER\"}" >/dev/null
check "a branch holiday does not stop an online session" "$(api GET "/api/groups/schedule?from=$SUN&to=$SUN" | jq_ "[o['status'] for o in d['data']['sessions'] if o['groupId']=='$CVG']")" "['NOT_STARTED']"
M "DELETE FROM Holiday WHERE name='E2E branch day off'"
check "a secretary of another branch cannot change the group's sessions" "$(secapi POST /api/groups/$CVG/session-mode "{\"date\":\"$TUE\",\"mode\":\"ONLINE\"}" | jq_ "d['success']")" "False"
echo "== 70. Rooms of branches and partner places (a02 batch 3, 2026-10-31)"
check "a place starts with rooms not kept (no checks)" "$(api GET /api/places/$DOTHER/rooms | jq_ "d['data']['campus']['roomMode']")" "NONE"
api PUT /api/places/$DOTHER/rooms '{"roomMode":"FIXED"}' >/dev/null
R1=$(api POST /api/places/$DOTHER/rooms '{"name":"E2E Small Lab","capacity":3,"kind":"ROBOTICS"}' | jq_ "d['data']['id']")
R2=$(api POST /api/places/$DOTHER/rooms '{"name":"E2E Big Room","capacity":20,"kind":"CLASSROOM"}' | jq_ "d['data']['id']")
check "named rooms are added (same name twice refused)" "$([ -n "$R1" ] && [ "$R1" != "None" ] && [ -n "$R2" ] && echo yes)/$(api POST /api/places/$DOTHER/rooms '{"name":"E2E Big Room","capacity":5}' | jq_ "d['error']['code']")" "yes/CONFLICT"
check "a branch session with no room is refused once the place keeps rooms" "$(api PATCH /api/groups/$CVG '{"scheduleSlots":[{"dayOfWeek":0,"time":"16:00","mode":"ONLINE"},{"dayOfWeek":2,"time":"18:00","mode":"BRANCH"}]}' | jq_ "d['error']['code']")" "ROOM_PROBLEM"
check "a room too small for the group is refused" "$(api PATCH /api/groups/$CVG "{\"maxStudents\":5,\"scheduleSlots\":[{\"dayOfWeek\":2,\"time\":\"18:00\",\"mode\":\"BRANCH\",\"roomId\":\"$R1\"}]}" | jq_ "(d['error']['code'], 'E2E Small Lab' in d['error']['message'])")" "('ROOM_PROBLEM', True)"
check "with a free big room it is saved" "$(api PATCH /api/groups/$CVG "{\"maxStudents\":null,\"scheduleSlots\":[{\"dayOfWeek\":0,\"time\":\"16:00\",\"mode\":\"ONLINE\"},{\"dayOfWeek\":2,\"time\":\"18:00\",\"mode\":\"BRANCH\",\"roomId\":\"$R2\"}]}" | jq_ "d['success']")" "True"
RG2=$(api POST /api/groups "{\"campusId\":\"$DOTHER\",\"className\":\"E2E Room Group\",\"sectionName\":\"R\",\"levelId\":\"$CVL\"}" | jq_ "d['data']['id']")
check "the same room at an overlapping time is refused (session = 90 min)" "$(api PATCH /api/groups/$RG2 "{\"scheduleSlots\":[{\"dayOfWeek\":2,\"time\":\"18:30\",\"mode\":\"BRANCH\",\"roomId\":\"$R2\"}]}" | jq_ "(d['error']['code'], 'E2E Curriculum Group' in d['error']['message'])")" "('ROOM_PROBLEM', True)"
check "…after the first session it is free" "$(api PATCH /api/groups/$RG2 "{\"scheduleSlots\":[{\"dayOfWeek\":2,\"time\":\"19:30\",\"mode\":\"BRANCH\",\"roomId\":\"$R2\"}]}" | jq_ "d['success']")" "True"
check "a Super Admin may force a clash (logged)" "$(api PATCH /api/groups/$RG2 "{\"forceRooms\":true,\"scheduleSlots\":[{\"dayOfWeek\":2,\"time\":\"18:30\",\"mode\":\"BRANCH\",\"roomId\":\"$R2\"}]}" | jq_ "d['success']")/$(M "SELECT COUNT(*)>0 FROM AuditLog WHERE action='FORCE_ROOMS' AND entityId='$RG2'")" "True/1"
api PATCH /api/groups/$RG2 "{\"scheduleSlots\":[{\"dayOfWeek\":2,\"time\":\"19:30\",\"mode\":\"BRANCH\",\"roomId\":\"$R2\"}]}" >/dev/null
api PATCH /api/groups/$CVG "{\"scheduleSlots\":[{\"dayOfWeek\":0,\"time\":\"16:00\",\"mode\":\"ONLINE\"},{\"dayOfWeek\":2,\"time\":\"18:00\",\"mode\":\"BRANCH\",\"roomId\":\"$R1\"}]}" >/dev/null
check "a group in a 3-seat room takes 3 students at most" "$(api GET /api/groups/$CVG | jq_ "d['data']['seats']['max']")" "3"
check "weekly use of each room (90 min in the small lab)" "$(api GET /api/places/$DOTHER/rooms | jq_ "[u['minutesPerWeek'] for u in d['data']['usage'] if u['roomId']=='$R1']")" "[90]"
api PUT /api/places/$DOTHER/rooms '{"roomMode":"DAILY","dayCounts":[0,0,1,0,0,0,0]}' >/dev/null
check "a place with 1 room on Tuesday: a second Tuesday session at the same time is refused" "$(api PATCH /api/groups/$RG2 '{"scheduleSlots":[{"dayOfWeek":2,"time":"18:30","mode":"BRANCH"}]}' | jq_ "d['error']['code']")" "ROOM_PROBLEM"
check "a branch secretary cannot change another place's rooms" "$(secapi PUT /api/places/$DOTHER/rooms '{"roomMode":"NONE"}' | jq_ "d['success']")" "False"
api PUT /api/places/$DOTHER/rooms '{"roomMode":"NONE"}' >/dev/null
echo "== 71. Instructor working hours (a02 batch 4, 2026-10-31)"
EW=$(M "SELECT t.id FROM Teacher t JOIN User u ON u.id=t.userId WHERE u.email='every@e2e.local'")
check "e2e data: an instructor with no groups yet" "$([ -n "$EW" ] && echo yes)/$(M "SELECT COUNT(*) FROM SubjectOffering o JOIN ClassSection c ON c.id=o.classSectionId WHERE o.teacherId='$EW' AND c.status='ACTIVE'")" "yes/0"
check "no hours entered = always available (he can take the group)" "$(api POST /api/groups/$RG2/instructor "{\"teacherId\":\"$EW\"}" | jq_ "d['success']")" "True"
api POST /api/groups/$RG2/instructor '{"teacherId":null}' >/dev/null
check "working hours are saved (Sunday shift in the partner place)" "$(api PUT /api/teachers/$EW/work-hours "{\"rows\":[{\"dayOfWeek\":0,\"fromTime\":\"14:00\",\"toTime\":\"20:00\",\"kind\":\"SHIFT\",\"campusId\":\"$DOTHER\"}]}" | jq_ "len(d['data']['rows'])")" "1"
check "a group with a Tuesday session outside his hours is refused (409)" "$(api POST /api/groups/$CVG/instructor "{\"teacherId\":\"$EW\"}" | jq_ "(d['error']['code'], 'outside' in d['error']['message'])")" "('TEACHER_PROBLEM', True)"
api PUT /api/teachers/$EW/work-hours "{\"rows\":[{\"dayOfWeek\":0,\"fromTime\":\"14:00\",\"toTime\":\"20:00\",\"kind\":\"SHIFT\",\"campusId\":\"$DOTHER\"},{\"dayOfWeek\":2,\"fromTime\":\"17:00\",\"toTime\":\"21:00\",\"kind\":\"AVAILABLE\",\"campusId\":null}]}" >/dev/null
check "with Tuesday hours added he gets the group" "$(api POST /api/groups/$CVG/instructor "{\"teacherId\":\"$EW\"}" | jq_ "d['success']")" "True"
check "…and a second group right after it (no overlap) too" "$(api POST /api/groups/$RG2/instructor "{\"teacherId\":\"$EW\"}" | jq_ "d['success']")" "True"
check "moving that group onto his other session is refused (clash)" "$(api PATCH /api/groups/$RG2 '{"scheduleSlots":[{"dayOfWeek":2,"time":"18:30","mode":"BRANCH"}]}' | jq_ "(d['error']['code'], 'clash' in d['error']['message'])")" "('TEACHER_PROBLEM', True)"
TBG=$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"className\":\"E2E Two Branch\",\"sectionName\":\"T\",\"levelId\":\"$CVL\"}" | jq_ "d['data']['id']")
api PATCH /api/groups/$TBG '{"scheduleSlots":[{"dayOfWeek":2,"time":"10:00","mode":"BRANCH"}]}' >/dev/null
api PUT /api/teachers/$EW/work-hours "{\"rows\":[{\"dayOfWeek\":0,\"fromTime\":\"14:00\",\"toTime\":\"20:00\",\"kind\":\"SHIFT\",\"campusId\":\"$DOTHER\"},{\"dayOfWeek\":2,\"fromTime\":\"09:00\",\"toTime\":\"21:00\",\"kind\":\"AVAILABLE\",\"campusId\":null}]}" >/dev/null
check "a branch session in another branch the same day is refused" "$(api POST /api/groups/$TBG/instructor "{\"teacherId\":\"$EW\"}" | jq_ "(d['error']['code'], 'another branch' in d['error']['message'])")" "('TEACHER_PROBLEM', True)"
check "a Super Admin may force it (logged)" "$(api POST /api/groups/$TBG/instructor "{\"teacherId\":\"$EW\",\"force\":true}" | jq_ "d['success']")/$(M "SELECT COUNT(*)>0 FROM AuditLog WHERE action='FORCE_TEACHER' AND entityId='$TBG'")" "True/1"
check "his page lists his hours and his weekly sessions" "$(api GET /api/teachers/$EW/work-hours | jq_ "(len(d['data']['rows']), len(d['data']['sessions']) >= 3)")" "(2, True)"
check "a secretary cannot change working hours" "$(secapi PUT /api/teachers/$EW/work-hours '{"rows":[]}' | jq_ "d['success']")" "False"
api POST /api/groups/$TBG/instructor '{"teacherId":null}' >/dev/null
M "DELETE FROM TeacherWorkHours WHERE teacherId='$EW'"
echo "== 72. Attendance detail for online / recorded sessions + technical excuse (a02 batch 5, 2026-10-31)"
LSUN=""; LTUE=""; for i in 0 1 2 3 4 5 6; do [ -z "$LSUN" ] && [ "$(cairo +%w -$i)" = "0" ] && LSUN=$(D -$i); [ -z "$LTUE" ] && [ "$(cairo +%w -$i)" = "2" ] && LTUE=$(D -$i); done
MEN=$(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$CVG' AND studentId='$MST'")
check "e2e data: last Sunday (online) and Tuesday (branch) of the group" "$([ -n "$LSUN" ] && [ -n "$LTUE" ] && [ -n "$MEN" ] && echo yes)" "yes"
api POST /api/enrollment-attendance "{\"classSectionId\":\"$CVG\",\"attendanceDate\":\"$LSUN\",\"records\":[{\"studentEnrollmentId\":\"$MEN\",\"status\":\"PRESENT\",\"minutes\":40}]}" >/dev/null
check "online session, 40 of 90 minutes -> present, 'part of the session', way ONLINE" "$(M "SELECT CONCAT(status,'/',mode,'/',presenceDetail,'/',minutes) FROM EnrollmentAttendanceRecord WHERE studentEnrollmentId='$MEN' AND attendanceDate='$LSUN'")" "PRESENT/ONLINE/PARTIAL/40"
api POST /api/enrollment-attendance "{\"classSectionId\":\"$CVG\",\"attendanceDate\":\"$LSUN\",\"records\":[{\"studentEnrollmentId\":\"$MEN\",\"status\":\"PRESENT\",\"detail\":\"CAMERA_OFF\",\"minutes\":85}]}" >/dev/null
check "…saved again with camera off and 85 minutes" "$(M "SELECT CONCAT(presenceDetail,'/',minutes) FROM EnrollmentAttendanceRecord WHERE studentEnrollmentId='$MEN' AND attendanceDate='$LSUN'")" "CAMERA_OFF/85"
api POST /api/enrollment-attendance "{\"classSectionId\":\"$CVG\",\"attendanceDate\":\"$LTUE\",\"records\":[{\"studentEnrollmentId\":\"$MEN\",\"status\":\"PRESENT\",\"detail\":\"CAMERA_OFF\",\"minutes\":30}]}" >/dev/null
check "a branch session keeps no online detail" "$(M "SELECT CONCAT(mode,'/',IFNULL(presenceDetail,'-'),'/',IFNULL(minutes,'-')) FROM EnrollmentAttendanceRecord WHERE studentEnrollmentId='$MEN' AND attendanceDate='$LTUE'")" "BRANCH/-/-"
check "the attendance sheet shows what was saved" "$(api GET "/api/enrollment-attendance/roster?classSectionId=$CVG&date=$LSUN" | jq_ "[(e['todayDetail'], e['todayMinutes']) for e in d['data']['enrollments'] if e['studentEnrollmentId']=='$MEN']")" "[('CAMERA_OFF', 85)]"
check "the family's attendance timeline says how (Arabic)" "$(api GET /api/students/$MST/attendance-timeline | PYTHONUTF8=1 jq_ "[s['how']['ar'] for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LSUN' and s.get('how')]")" "['حضر أونلاين — الكاميرا كانت مقفولة']"
NSUN=""; for i in 1 2 3 4 5 6 7; do [ -z "$NSUN" ] && [ "$(cairo +%w $i)" = "0" ] && NSUN=$(D $i); done
api POST /api/absence-excuses "{\"studentId\":\"$MST\",\"classSectionId\":\"$CVG\",\"sessionDate\":\"$NSUN\",\"reason\":\"Internet cut\",\"kind\":\"TECHNICAL\"}" >/dev/null
check "a technical-problem excuse is kept as such" "$(M "SELECT kind FROM AbsenceExcuse WHERE studentId='$MST' AND classSectionId='$CVG' AND sessionDate='$NSUN'")" "TECHNICAL"
echo "== 73. Instructor pay for online sessions + a link for one session (a02 batch 6, 2026-10-31)"
check "e2e data: the online-way instructor gets the curriculum group (Super Admin force)" "$(api POST /api/groups/$CVG/instructor "{\"teacherId\":\"$EW\",\"force\":true}" | jq_ "d['success']")" "True"
M "UPDATE EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId SET r.taughtByTeacherId='$EW' WHERE e.classSectionId='$CVG'"
check "instructor default pay: 100 per session, 80 per online session" "$(api PATCH /api/teachers/$EW '{"defaultPerSessionAmount":100,"defaultOnlinePerSessionAmount":80}' | jq_ "d['success']")/$(M "SELECT CONCAT(ROUND(defaultPerSessionAmount),'/',ROUND(defaultOnlinePerSessionAmount)) FROM Teacher WHERE id='$EW'")" "True/100/80"
check "pay statement: the online Sunday is paid 80" "$(api GET "/api/teachers/$EW/pay-statement?month=${LSUN:0:7}&groupId=$CVG" | jq_ "[(s['mode'], s['rate']) for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LSUN']")" "[('ONLINE', 80)]"
check "pay statement: the branch Tuesday is paid 100" "$(api GET "/api/teachers/$EW/pay-statement?month=${LTUE:0:7}&groupId=$CVG" | jq_ "[(s['mode'], s['rate']) for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LTUE']")" "[('BRANCH', 100)]"
check "the group's own online rate wins (70)" "$(api PATCH /api/groups/$CVG/instructor-pay '{"perSessionAmount":100,"onlinePerSessionAmount":70}' | jq_ "d['success']")/$(api GET "/api/teachers/$EW/pay-statement?month=${LSUN:0:7}&groupId=$CVG" | jq_ "[s['rate'] for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LSUN']")" "True/[70]"
check "group money: the cycle splits online sessions" "$(api GET /api/groups/$CVG/financials | jq_ "(d['data']['teacherPay']['onlineSessions'], d['data']['teacherPay']['onlinePerSessionAmount'])")" "(1, 70)"
check "a recorded session is not paid per session" "$(M "INSERT INTO SessionModeOverride (id,classSectionId,date,mode,createdAt) VALUES ('e2e-rec-$LSUN','$CVG','$LSUN','RECORDED',NOW())" >/dev/null; api GET "/api/teachers/$EW/pay-statement?month=${LSUN:0:7}&groupId=$CVG" | jq_ "[(s['mode'], s['counted'], s.get('rate')) for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LSUN']")" "[('RECORDED', False, None)]"
M "DELETE FROM SessionModeOverride WHERE id='e2e-rec-$LSUN'"
api PATCH /api/groups/$CVG/instructor-pay '{"perSessionAmount":null,"onlinePerSessionAmount":null}' >/dev/null
EWP=$(api GET /api/teachers/$EW/places)
check "pay per place keeps an online amount" "$(api PUT /api/teachers/$EW/places "$(echo "$EWP" | python -c "import sys,json;d=json.load(sys.stdin)['data'];d['pay']=[{'campusId':'$DOTHER','fixed':None,'percent':None,'perSession':90,'onlineFixed':None,'onlinePercent':12,'onlinePerSession':60}];print(json.dumps(d))")" | jq_ "d['success']")/$(api GET /api/teachers/$EW/places | jq_ "[(p['perSession'], p['onlinePercent'], p['onlinePerSession']) for p in d['data']['pay'] if p['campusId']=='$DOTHER']")" "True/[(90, 12, 60)]"
check "…and the place's online rate is used for the online Sunday" "$(api GET "/api/teachers/$EW/pay-statement?month=${LSUN:0:7}&groupId=$CVG" | jq_ "[s['rate'] for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LSUN']")" "[60]"
check "a link for one session only is saved" "$(api PATCH /api/groups/$CVG/online "{\"date\":\"$NSUN\",\"sessionUrl\":\"https://meet.google.com/abc-defg-hij\"}" | jq_ "d['success']")/$(api GET "/api/groups/$CVG/online?date=$NSUN" | jq_ "d['data']['sessionUrl']")" "True/https://meet.google.com/abc-defg-hij"
check "…another day keeps the group link (none)" "$(api GET "/api/groups/$CVG/online?date=$LSUN" | jq_ "d['data']['sessionUrl']")" "None"
check "…a bad link is refused" "$(api PATCH /api/groups/$CVG/online "{\"date\":\"$NSUN\",\"sessionUrl\":\"javascript:alert(1)\"}" | jq_ "d['success']")" "False"
check "a secretary cannot set a session link" "$(secapi PATCH /api/groups/$CVG/online "{\"date\":\"$NSUN\",\"sessionUrl\":\"https://zoom.us/j/1\"}" | jq_ "d['success']")" "False"
echo "== 74. Daily cash-close sheet (a04, 2026-10-31)"
DAYS=$(api GET "/api/treasury/daily?date=$(D 0)")
check "the totals page lists every account, cash boxes first" "$(echo "$DAYS" | jq_ "(d['data']['sheets'][0]['account']['kind'], any(s['account']['id']=='$TBOX' for s in d['data']['sheets']), any(s['account']['id']=='$TBANK' for s in d['data']['sheets']))")" "('CASH', True, True)"
SH=$(api GET "/api/treasury/daily/$TBOX?date=$(D 0)")
check "the box's sheet: opening + in − out = what should be there" "$(echo "$SH" | jq_ "abs(d['data']['opening'] + d['data']['totalIn'] - d['data']['totalOut'] - d['data']['expected']) < 0.01")" "True"
check "…money in is grouped by kind (invoice payments listed one by one)" "$(echo "$SH" | jq_ "[(g['kind'], g['count']==len(g['lines'])) for g in d['data']['inGroups'] if g['kind']=='PAYMENT']")" "[('PAYMENT', True)]"
CIDT=$(echo "$SH" | jq_ "d['data']['count']['id'] if d['data']['count'] else ''")
BNOW=$(api GET /api/treasury | jq_ "[a['balance'] for a in d['data']['accounts'] if a['id']=='$TBOX'][0]")
check "…with today's count: the books now = what should be there + the count difference booked" "$(echo "$SH" | jq_ "round(d['data']['expected'] + float('$(M "SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount ELSE -amount END),0) FROM MoneyMovement WHERE cashCountId='$CIDT'")') - $BNOW, 2) == 0")" "True"
check "…the difference shown is the one that was approved (counted − the books at the time of the count)" "$(echo "$SH" | jq_ "round(d['data']['difference'] - float('$(M "SELECT difference FROM CashCount WHERE id='$CIDT'")'), 2) == 0")" "True"
check "…who counted is recorded by name and time" "$(echo "$SH" | jq_ "(d['data']['state'] in ('APPROVED','PENDING'), bool(d['data']['count']['countedBy']), bool(d['data']['count']['countedAt']))")" "(True, True, True)"
check "a day with no count still has a sheet: 'not counted yet'" "$(api GET "/api/treasury/daily/$TBOX?date=$(D 1)" | jq_ "(d['data']['state'], d['data']['difference'])")" "('NOT_COUNTED', None)"
M "INSERT INTO CashCount (id,accountId,date,expected,counted,difference,status,countedById,createdAt) VALUES ('e2e-ycount','$TBOX','$(D 0)',0,777,0,'APPROVED',(SELECT id FROM User WHERE role='SUPER_ADMIN' LIMIT 1),NOW())"
check "the next day opens with the approved count of the day before" "$(api GET "/api/treasury/daily/$TBOX?date=$(D 1)" | jq_ "(d['data']['opening'], d['data']['openingSource'])")" "(777, 'YESTERDAY_COUNT')"
M "DELETE FROM CashCount WHERE id='e2e-ycount'"
check "a branch secretary sees only the branch accounts (not the company bank)" "$(secapi GET "/api/treasury/daily?date=$(D 0)" | jq_ "any(s['account']['id']=='$TBANK' for s in d['data']['sheets'])")" "False"
check "Excel: the totals and one box's sheet download as .xlsx" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}/%{content_type}' "$B/api/treasury/daily?date=$(D 0)&format=xlsx" | cut -c1-24)/$(curl -s -b "$JAR" "$B/api/treasury/daily/$TBOX?date=$(D 0)&format=xlsx" | head -c 2)" "200/application/vnd.open/PK"
check "a bad day is refused; signed-out gets 401" "$(api GET "/api/treasury/daily?date=31-10-2026" | jq_ "d['success']")/$(curl -s -o /dev/null -w '%{http_code}' "$B/api/treasury/daily")" "False/401"
echo "== 75. One-to-One: price list, booking, siblings, instructor rate, next cycle (a02 M3 batch 1, 2026-11-01)"
M "INSERT INTO TeacherQualifiedSubject (id,teacherId,levelId,createdAt) VALUES ('e2e-q-11','$EW','$CVL',NOW())"
M "UPDATE User SET allLocations=1 WHERE id=(SELECT userId FROM Teacher WHERE id='$EW')"
M "DELETE FROM TeacherWorkHours WHERE teacherId='$EW'"
OS1=$(mkstu Oneboy 01000000751 Oneparent 01000000752); OS2=$(mkstu Twoboy 01000000753 Oneparent 01000000752); OS3=$(mkstu Otherboy 01000000754 Otherparent 01000000755)
SL='[{"dayOfWeek":5,"time":"06:30","mode":"BRANCH"}]'
BODY() { echo "{\"studentIds\":$1,\"campusId\":\"$CAMPUS\",\"levelId\":\"$CVL\",\"plan\":\"$2\",\"sessions\":$3,\"slots\":$4,\"teacherId\":\"$EW\"${5:-}}"; }
check "no price yet: booking refused, nothing left behind" "$(api POST /api/one-to-one "$(BODY "[\"$OS1\"]" SESSION 3 "$SL")" | jq_ "d['error']['code']")/$(M "SELECT COUNT(*) FROM ClassSection WHERE kind='ONE_TO_ONE'")" "NO_PRICE/0"
api POST /api/one-to-one/prices "{\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"price\":300,\"siblingPrice\":200,\"minutes\":60}" >/dev/null
PMON=$(api POST /api/one-to-one/prices "{\"levelId\":\"$CVL\",\"plan\":\"MONTH\",\"price\":1000}" | jq_ "(d['data']['sessions'])")
check "a month price takes the level's sessions of a month" "$([ "$PMON" -ge 1 ] 2>/dev/null && echo yes)" "yes"
api POST /api/one-to-one/prices "{\"levelId\":\"$CVL\",\"plan\":\"PACKAGE\",\"sessions\":8,\"price\":1800}" >/dev/null
check "the price list: session, month and package" "$(api GET "/api/one-to-one/prices?levelId=$CVL" | jq_ "sorted(r['plan'] for r in d['data'])")" "['MONTH', 'PACKAGE', 'SESSION']"
check "a package needs its size" "$(api POST /api/one-to-one/prices "{\"levelId\":\"$CVL\",\"plan\":\"PACKAGE\",\"price\":100}" | jq_ "d['success']")" "False"
check "a branch secretary cannot set a price for everywhere" "$(secapi POST /api/one-to-one/prices "{\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"price\":1}" | jq_ "d['success']")" "False"
check "only qualified and free instructors are offered" "$(api GET "/api/one-to-one/instructors?campusId=$CAMPUS&levelId=$CVL&slots=%5B%7B%22dayOfWeek%22%3A5%2C%22time%22%3A%2206%3A30%22%7D%5D" | jq_ "any(t['id']=='$EW' for t in d['data'])")" "True"
OB=$(api POST /api/one-to-one "$(BODY "[\"$OS1\"]" SESSION 3 "$SL")")
OG=$(echo "$OB" | jq_ "d['data']['groupId']")
check "booking 3 sessions: 3 x 300 for the student" "$(echo "$OB" | jq_ "(d['data']['amountEach'], d['data']['sessions'], d['data']['sibling'])")" "(900, 3, False)"
check "stored as One-to-One: plan, sessions, minutes, one seat" "$(M "SELECT CONCAT(kind,'/',oneToOnePlan,'/',cycleSessions,'/',sessionMinutes,'/',maxStudents,'/',requireFullPaymentToStart) FROM ClassSection WHERE id='$OG'")" "ONE_TO_ONE/SESSION/3/60/1/1"
check "the invoice is made from the booked price" "$(inv $OS1 $OG | cut -d/ -f1)" "900"
check "it is NOT on the Groups list; pick lists can still ask for it" "$(api GET /api/groups | jq_ "any(g['id']=='$OG' for g in d['data'])")/$(api GET '/api/groups?kind=ALL' | jq_ "any(g['id']=='$OG' for g in d['data'])")" "False/True"
check "it is on the One-to-One list with its sessions" "$(api GET /api/one-to-one | jq_ "[(r['sessionsDone'], r['sessionsTotal'], len(r['students']), r['teacher']['id']=='$EW') for r in d['data'] if r['id']=='$OG']")" "[(0, 3, 1, True)]"
check "the attendance list still has it" "$(api GET '/api/class-sections?limit=500' | python -c "import sys,json;d=json.load(sys.stdin)['data'];print(any(g['id']=='$OG' for g in (d if isinstance(d,list) else d.get('items',d.get('sections',[])))))")" "True"
check "the seat is taken: nobody else joins" "$(api POST /api/groups/$OG/students "{\"studentId\":\"$OS3\"}" | jq_ "d['error']['code']")" "GROUP_FULL"
check "the same instructor at the same time is refused, nothing left behind" "$(C0=$(M "SELECT COUNT(*) FROM ClassSection WHERE kind='ONE_TO_ONE'"); R=$(api POST /api/one-to-one "$(BODY "[\"$OS3\"]" SESSION 2 "$SL")" | jq_ "d['error']['code']"); echo "$R/$(( $(M "SELECT COUNT(*) FROM ClassSection WHERE kind='ONE_TO_ONE'") - C0 ))")" "TEACHER_PROBLEM/0"
SL2='[{"dayOfWeek":5,"time":"09:00","mode":"BRANCH"}]'
check "two who are not siblings cannot share a session" "$(api POST /api/one-to-one "$(BODY "[\"$OS1\",\"$OS3\"]" SESSION 2 "$SL2")" | jq_ "d['error']['code']")" "NOT_SIBLINGS"
SB=$(api POST /api/one-to-one "$(BODY "[\"$OS1\",\"$OS2\"]" SESSION 4 "$SL2" ",\"teacherRate\":200,\"payment\":\"INSTALLMENTS\"")")
SG=$(echo "$SB" | jq_ "d['data']['groupId']")
check "two siblings in one session: the sibling price each, two seats, two invoices" "$(echo "$SB" | jq_ "(d['data']['amountEach'], d['data']['sibling'])")/$(M "SELECT maxStudents FROM ClassSection WHERE id='$SG'")/$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$SG' AND subtotal=800")" "(800, True)/2/2"
check "instalments chosen, and this One-to-One's own instructor rate" "$(M "SELECT CONCAT(installmentsAllowed,'/',requireFullPaymentToStart) FROM ClassSection WHERE id='$SG'")/$(M "SELECT ROUND(overrideOneToOnePerSession) FROM SubjectOffering WHERE classSectionId='$SG'")" "1/0/200"
check "a secretary cannot book in another place" "$(secapi POST /api/one-to-one "{\"studentIds\":[\"$OS3\"],\"campusId\":\"$DOTHER\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":1,\"slots\":$SL2,\"teacherId\":\"$EW\"}" | jq_ "d['success']")" "False"
check "signed out: 401" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/one-to-one")" "401"
LFRI=""; for i in 0 1 2 3 4 5 6; do [ -z "$LFRI" ] && [ "$(cairo +%w -$i)" = "5" ] && LFRI=$(D -$i); done
OEN=$(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$OG' AND studentId='$OS1'")
api POST /api/enrollment-attendance "{\"classSectionId\":\"$OG\",\"attendanceDate\":\"$LFRI\",\"records\":[{\"studentEnrollmentId\":\"$OEN\",\"status\":\"PRESENT\"}]}" >/dev/null
M "UPDATE EnrollmentAttendanceRecord SET taughtByTeacherId='$EW' WHERE studentEnrollmentId='$OEN'"
api PATCH /api/teachers/$EW '{"defaultPerSessionAmount":100,"defaultOneToOnePerSession":150}' >/dev/null
check "instructor pay: the One-to-One rate, not the normal one" "$(api GET "/api/teachers/$EW/pay-statement?month=${LFRI:0:7}&groupId=$OG" | jq_ "[s['rate'] for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LFRI']")" "[150]"
check "the list counts the session held" "$(api GET /api/one-to-one | jq_ "[(r['sessionsDone'], r['sessionsLeft']) for r in d['data'] if r['id']=='$OG']")" "[(1, 2)]"
check "the next cycle waits until its sessions are done" "$(api POST /api/one-to-one/$OG/renew '{}' | jq_ "d['success']")" "False"
NG=$(api POST /api/one-to-one/$OG/renew '{"force":true}' | jq_ "d['data']['newGroupId']")
check "next cycle (Super Admin forced it): same kind, plan, sessions and price; the old one finished" "$(M "SELECT CONCAT(kind,'/',oneToOnePlan,'/',cycleSessions,'/',ROUND(priceOverride),'/',maxStudents,'/',levelId='$CVL') FROM ClassSection WHERE id='$NG'")/$(M "SELECT status FROM ClassSection WHERE id='$OG'")" "ONE_TO_ONE/SESSION/3/900/1/1/COMPLETED"
check "the student is billed for the next cycle" "$(inv $OS1 $NG | cut -d/ -f1)" "900"
check "the next cycle is not on the Groups list either" "$(api GET /api/groups | jq_ "any(g['id']=='$NG' for g in d['data'])")" "False"
echo "== 76. One-to-One: parent request, instructor accepts or passes, staff place it (a02 M3 batch 2, 2026-11-02)"
M "INSERT INTO TeacherQualifiedSubject (id,teacherId,levelId,createdAt) VALUES ('e2e-q-12','$CALT','$CVL',NOW())"
M "UPDATE User SET allLocations=1 WHERE id=(SELECT userId FROM Teacher WHERE id='$CALT')"
M "DELETE FROM TeacherWorkHours WHERE teacherId='$CALT'"
OPG=$(M "SELECT A FROM _GuardianToStudent WHERE B='$OS1' LIMIT 1")
OPW=$(api POST /api/students/$OS1/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$OPG\"}" | jq_ "d['data']['password']")
OPJ=$(mktemp); login_jar 01000000752 "$OPW" "$OPJ" 10.0.3.76
papi() { curl -s -b "$OPJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
TJ76=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ76" 10.0.3.77
tapi() { curl -s -b "$TJ76" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
RS() { echo "[{\"dayOfWeek\":6,\"time\":\"$1\",\"mode\":\"BRANCH\"}]"; }
RB() { echo "{\"studentId\":\"$1\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":2,\"slots\":$(RS "$2")${3:-}}"; }
check "the parent sees the level and its plans, and the sibling" "$(papi GET "/api/guardian-portal/one-to-one?studentId=$OS1" | jq_ "(any(l['id']=='$CVL' for l in d['data']['levels']), [s['id']=='$OS2' for s in d['data']['siblings']])")" "(True, [True])"
check "another family's child is refused" "$(papi GET "/api/guardian-portal/one-to-one?studentId=$OS3" | jq_ "d['success']")" "False"
check "staff cannot use the parent route" "$(api GET "/api/guardian-portal/one-to-one?studentId=$OS1" | jq_ "d['success']")" "False"
check "the parent sees how many are free, not who" "$(papi GET "/api/guardian-portal/one-to-one?studentId=$OS1&levelId=$CVL&slots=%5B%7B%22dayOfWeek%22%3A6%2C%22time%22%3A%2207%3A00%22%7D%5D" | jq_ "(d['data']['available']>=2, d['data']['teachers'])")" "(True, [])"
check "not a sibling: refused" "$(papi POST /api/guardian-portal/one-to-one "$(RB $OS1 07:00 ",\"siblingId\":\"$OS3\"")" | jq_ "d['error']['code']")" "NOT_SIBLINGS"
NOLV=$(M "SELECT id FROM Level WHERE id<>'$CVL' AND id NOT IN (SELECT levelId FROM TeacherQualifiedSubject WHERE levelId IS NOT NULL) LIMIT 1")
api POST /api/one-to-one/prices "{\"levelId\":\"$NOLV\",\"plan\":\"SESSION\",\"price\":100}" >/dev/null
check "no instructor free for that level: refused at once, no request kept" "$(papi POST /api/guardian-portal/one-to-one "{\"studentId\":\"$OS1\",\"levelId\":\"$NOLV\",\"plan\":\"SESSION\",\"sessions\":1,\"slots\":$(RS 07:00)}" | jq_ "d['error']['code']")/$(M "SELECT COUNT(*) FROM OneToOneRequest WHERE levelId='$NOLV'")" "NO_TEACHER/0"
R1=$(papi POST /api/guardian-portal/one-to-one "$(RB $OS1 07:00)" | jq_ "d['data']['id']")
check "the request goes to one instructor, with a deadline" "$(M "SELECT CONCAT(state,'/',teacherId='$CALT',' ',expiresAt>NOW()) FROM OneToOneRequest WHERE id='$R1'")" "OFFERED/1 1"
check "no second request for the same level while one waits" "$(papi POST /api/guardian-portal/one-to-one "$(RB $OS1 08:40)" | jq_ "d['error']['code']")" "ALREADY_ASKED"
check "the instructor sees it (no surname of the child) + a task today + a notification" "$(tapi GET /api/teacher-portal/one-to-one-offers | jq_ "[(o['students'], o['id']=='$R1') for o in d['data']]")/$(tapi GET /api/today | jq_ "any(t['key']=='oneToOneOffers' for t in d['data']['tasks'])")/$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='ONE_TO_ONE_OFFER' AND relatedId='$R1'")" "[(['Oneboy'], True)]/True/1"
check "he declines: it goes to the next instructor" "$(tapi POST /api/teacher-portal/one-to-one-offers/$R1 '{"accept":false}' | jq_ "d['data']['booked']")/$(M "SELECT CONCAT(state,'/',teacherId='$EW') FROM OneToOneRequest WHERE id='$R1'")" "False/OFFERED/1"
check "it is no longer his to answer" "$(tapi POST /api/teacher-portal/one-to-one-offers/$R1 '{"accept":true}' | jq_ "d['error']['code']")" "OFFER_GONE"
M "UPDATE OneToOneRequest SET expiresAt=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id='$R1'"
check "no answer in time and nobody left: staff must place it, and see a task" "$(api GET /api/one-to-one/requests | jq_ "[(r['state'], r['triedCount']) for r in d['data'] if r['id']=='$R1']")/$(api GET /api/today | jq_ "any(t['key']=='oneToOneRequests' for t in d['data']['tasks'])")" "[('NO_TEACHER', 2)]/True"
check "staff place it with an instructor: booked, invoice made, family told" "$(api PATCH /api/one-to-one/requests/$R1 "{\"action\":\"assign\",\"teacherId\":\"$CALT\"}" | jq_ "d['success']")/$(M "SELECT state FROM OneToOneRequest WHERE id='$R1'")/$(M "SELECT COUNT(*) FROM FeeInvoice i JOIN OneToOneRequest r ON r.groupId=i.classSectionId WHERE r.id='$R1' AND i.studentId='$OS1' AND i.subtotal=600")/$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='ONE_TO_ONE_BOOKED' AND relatedId='$R1'")" "True/BOOKED/1/1"
R2=$(papi POST /api/guardian-portal/one-to-one "$(RB $OS2 08:40)" | jq_ "d['data']['id']")
check "the instructor accepts: booked on his schedule, not on the Groups list" "$(tapi POST /api/teacher-portal/one-to-one-offers/$R2 '{"accept":true}' | jq_ "d['data']['booked']")/$(M "SELECT CONCAT(g.kind,'/',o.teacherId='$CALT') FROM OneToOneRequest r JOIN ClassSection g ON g.id=r.groupId JOIN SubjectOffering o ON o.classSectionId=g.id WHERE r.id='$R2'")/$(api GET /api/groups | jq_ "any(g['id']=='$(M "SELECT groupId FROM OneToOneRequest WHERE id='$R2'")' for g in d['data'])")" "True/ONE_TO_ONE/1/False"
check "a booked request cannot be cancelled by the parent" "$(papi DELETE /api/guardian-portal/one-to-one/$R2 | jq_ "d['success']")" "False"
R3=$(papi POST /api/guardian-portal/one-to-one "$(RB $OS1 10:20 ",\"siblingId\":\"$OS2\"")" | jq_ "d['data']['id']")
check "two siblings in one request; the parent can cancel while it waits" "$(M "SELECT siblingId='$OS2' FROM OneToOneRequest WHERE id='$R3'")/$(papi DELETE /api/guardian-portal/one-to-one/$R3 | jq_ "d['success']")/$(M "SELECT state FROM OneToOneRequest WHERE id='$R3'")" "1/True/CANCELLED"
check "the parent sees how each request stands" "$(papi GET "/api/guardian-portal/one-to-one?studentId=$OS1" | jq_ "sorted(r['state'] for r in d['data']['requests'])")" "['BOOKED', 'BOOKED', 'CANCELLED']"
check "a secretary cannot change the company settings" "$(secapi PUT /api/one-to-one/settings '{"replyHours":1}' | jq_ "d['success']")" "False"
api PUT /api/one-to-one/settings '{"portalOpen":false}' >/dev/null
check "portal closed: the parent cannot ask" "$(papi POST /api/guardian-portal/one-to-one "$(RB $OS1 12:00)" | jq_ "d['error']['code']")" "PORTAL_CLOSED"
api PUT /api/one-to-one/settings '{"portalOpen":true,"assignWithoutAsking":true}' >/dev/null
RM=$(M "SELECT roomMode FROM Campus WHERE id='$CAMPUS'")
api PUT /api/places/$CAMPUS/rooms '{"roomMode":"FIXED"}' >/dev/null
RMR=$(api POST /api/places/$CAMPUS/rooms '{"name":"E2E One Room","capacity":2,"kind":"CLASSROOM"}' | jq_ "d['data']['id']")
R4=$(papi POST /api/guardian-portal/one-to-one "$(RB $OS1 12:00)" | jq_ "d['data']['id']")
check "assign without asking: booked at once, and a place that keeps rooms gets a free room" "$(M "SELECT state FROM OneToOneRequest WHERE id='$R4'")/$(M "SELECT JSON_UNQUOTE(JSON_EXTRACT(g.scheduleSlots,'\$[0].roomId'))='$RMR' FROM OneToOneRequest r JOIN ClassSection g ON g.id=r.groupId WHERE r.id='$R4'")" "BOOKED/1"
api PUT /api/places/$CAMPUS/rooms "{\"roomMode\":\"$RM\"}" >/dev/null
api PUT /api/one-to-one/settings '{"assignWithoutAsking":false,"replyHours":24}' >/dev/null
check "settings are kept, and reply hours stay in range" "$(api GET /api/one-to-one/settings | jq_ "(d['data']['replyHours'], d['data']['assignWithoutAsking'], d['data']['portalOpen'])")" "(24, False, True)"
check "signed out: 401" "$(curl -s -o /dev/null -w '%{http_code}' "$B/api/teacher-portal/one-to-one-offers")" "401"
echo "== 77. One-to-One money and locks: refund limits, moves, discounts, partner terms (a02 M3 batch 3 part 1, 2026-11-02)"
KEEPRULES=$(api GET /api/refunds/rules)
OR1=$(M "SELECT groupId FROM OneToOneRequest WHERE id='$R1'")
ORI=$(M "SELECT id FROM FeeInvoice WHERE classSectionId='$OR1' AND studentId='$OS1' ORDER BY createdAt DESC LIMIT 1")
pay "$ORI" 600 >/dev/null
check "per-session refund price follows the booked sessions, not the level (600 / 2 = 300)" "$(api GET /api/refunds/suggest?invoiceId=$ORI | jq_ "(d['data']['perSession'], d['data']['sessionsInCycle'])")" "(300, 2)"
RULE() { echo "{\"scopeType\":\"$1\",\"scopeId\":$2,\"allowed\":$3,\"adminFeeType\":\"FIXED\",\"adminFeeValue\":0,\"deductBasis\":\"ATTENDED\",\"untilDaysBeforeFirst\":$4}"; }
api PUT /api/refunds/rules "{\"rules\":[$(RULE ONE_TO_ONE null false null)]}" >/dev/null
check "refunds closed on One-to-One" "$(api GET /api/refunds/suggest?invoiceId=$ORI | jq_ "d['data']['allowed']")" "False"
check "…a normal group is not touched by that rule" "$(M "SELECT scopeType FROM RefundRule LIMIT 1")/$(api GET "/api/refunds/suggest?invoiceId=$(M "SELECT i.id FROM FeeInvoice i JOIN ClassSection g ON g.id=i.classSectionId WHERE g.kind='GROUP' LIMIT 1")" | jq_ "d['data']['allowed']")" "ONE_TO_ONE/True"
api PUT /api/refunds/rules "{\"rules\":[$(RULE CAMPUS "\"$CAMPUS\"" false null)]}" >/dev/null
check "refunds closed for one place" "$(api GET /api/refunds/suggest?invoiceId=$ORI | jq_ "d['data']['allowed']")" "False"
api PUT /api/refunds/rules "{\"rules\":[$(RULE ONE_TO_ONE null true 0)]}" >/dev/null
check "open until the first session, while it has not started (a day limit of 0)" "$(api GET /api/refunds/suggest?invoiceId=$ORI | jq_ "d['data']['allowed']")" "True"
M "UPDATE ClassSection SET startDate=UTC_TIMESTAMP() WHERE id='$OR1'"
check "…closed once it has started" "$(api GET /api/refunds/suggest?invoiceId=$ORI | jq_ "d['data']['allowed']")" "False"
M "UPDATE ClassSection SET startDate=NULL WHERE id='$OR1'"
api PUT /api/refunds/rules "$(echo "$KEEPRULES" | python -c "import sys,json;print(json.dumps({'rules':[{k:r.get(k) for k in ('scopeType','scopeId','allowed','adminFeeType','adminFeeValue','deductBasis','note')} for r in json.load(sys.stdin)['data']]}))")" >/dev/null
OTGT=$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"className\":\"E2E Target Group\",\"sectionName\":\"T\",\"levelId\":\"$CVL\"}" | jq_ "d['data']['id']")
LOCKS() { echo "{\"all\":${1:-false},\"kinds\":${2:-[]},\"modes\":[],\"campusIds\":${3:-[]},\"partnerIds\":[]}"; }
api PUT /api/group-transfers/settings "$(LOCKS false '["ONE_TO_ONE"]')" >/dev/null
check "moves closed for One-to-One: refused with the reason" "$(api GET "/api/students/$OS1/transfer?from=$OR1&to=$OTGT" | jq_ "'One-to-One' in d['error']['message']")" "True"
api PUT /api/group-transfers/settings "$(LOCKS false '[]' "[\"$CAMPUS\"]")" >/dev/null
check "moves closed for a place" "$(api GET "/api/students/$OS1/transfer?from=$OR1&to=$OTGT" | jq_ "d['success']")" "False"
api PUT /api/group-transfers/settings "$(LOCKS true)" >/dev/null
check "moves closed everywhere" "$(api GET "/api/students/$OS1/transfer?from=$OR1&to=$OTGT" | jq_ "d['success']")" "False"
check "a secretary cannot open them" "$(secapi PUT /api/group-transfers/settings "$(LOCKS)" | jq_ "d['success']")" "False"
api PUT /api/group-transfers/settings "$(LOCKS)" >/dev/null
check "One-to-One to a group: what was not used becomes credit (2 sessions, none held = all 600)" "$(api GET "/api/students/$OS1/transfer?from=$OR1&to=$OTGT" | jq_ "d['data']['invoice']['credit']")" "600"
api POST /api/students/$OS1/transfer "{\"fromClassSectionId\":\"$OR1\",\"toClassSectionId\":\"$OTGT\",\"creditTo\":\"NEW_INVOICE\",\"discountDecisions\":[]}" >/dev/null
check "…the student is in the group now, out of the One-to-One" "$(M "SELECT CONCAT(e.status,'/',IFNULL(e.withdrawalReason,'-')) FROM StudentEnrollment e WHERE e.studentId='$OS1' AND e.classSectionId='$OR1'")/$(M "SELECT status FROM StudentEnrollment WHERE studentId='$OS1' AND classSectionId='$OTGT'")" "WITHDRAWN/TRANSFERRED/ACTIVE"
FG=$(api POST /api/one-to-one "{\"studentIds\":[\"$OS1\"],\"campusId\":\"$CAMPUS\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":2,\"slots\":[{\"dayOfWeek\":3,\"time\":\"07:00\",\"mode\":\"BRANCH\"}],\"teacherId\":\"$CALT\",\"fromGroupId\":\"$OTGT\"}")
check "a group to One-to-One: booked and moved in one step" "$(echo "$FG" | jq_ "d['success']")/$(M "SELECT withdrawalReason FROM StudentEnrollment WHERE studentId='$OS1' AND classSectionId='$OTGT'")/$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE classSectionId='$(echo "$FG" | jq_ "d['data']['groupId']")' AND studentId='$OS1' AND status='ACTIVE'")" "True/TRANSFERRED/1"
check "if the move is closed, nothing is left behind" "$(api PUT /api/group-transfers/settings "$(LOCKS true)" >/dev/null; C0=$(M "SELECT COUNT(*) FROM ClassSection WHERE kind='ONE_TO_ONE'"); R=$(api POST /api/one-to-one "{\"studentIds\":[\"$OS2\"],\"campusId\":\"$CAMPUS\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":2,\"slots\":[{\"dayOfWeek\":3,\"time\":\"09:00\",\"mode\":\"BRANCH\"}],\"teacherId\":\"$CALT\",\"fromGroupId\":\"$OTGT\"}" | jq_ "d['success']"); echo "$R/$(( $(M "SELECT COUNT(*) FROM ClassSection WHERE kind='ONE_TO_ONE'") - C0 ))")" "False/0"
api PUT /api/group-transfers/settings "$(LOCKS)" >/dev/null
DT=$(api POST /api/discount-types '{"name":"E2E Auto 10","kind":"PROMO","valueType":"PERCENT","value":10,"duration":"EVERY_CYCLE","autoApply":true,"approvalMode":"STAFF","scopeType":"ALL","stackable":true,"isActive":true}' | jq_ "d['data']['id']")
ODB=$(api POST /api/one-to-one "{\"studentIds\":[\"$OS3\"],\"campusId\":\"$CAMPUS\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":1,\"slots\":[{\"dayOfWeek\":3,\"time\":\"10:40\",\"mode\":\"BRANCH\"}],\"teacherId\":\"$CALT\"}" | jq_ "d['data']['groupId']")
check "a discount not chosen for One-to-One does not touch it" "$(inv $OS3 $ODB | cut -d/ -f1,2)" "300/0"
M "UPDATE DiscountType SET appliesToOneToOne=1 WHERE id='$DT'"
ODC=$(api POST /api/one-to-one "{\"studentIds\":[\"$OS3\"],\"campusId\":\"$CAMPUS\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":1,\"slots\":[{\"dayOfWeek\":3,\"time\":\"12:20\",\"mode\":\"BRANCH\"}],\"teacherId\":\"$CALT\"}" | jq_ "d['data']['groupId']")
check "chosen + automatic: it applies by itself" "$(inv $OS3 $ODC | cut -d/ -f1,2)" "300/30"
M "UPDATE DiscountType SET isActive=0 WHERE id='$DT'"
echo "== 78. One-to-One sessions: postpone, instructor apology, no-show, holidays per system, rules (a02 M3 batch 3 part 2, 2026-11-02)"
DW3=$(cairo +%w 3)  # the weekday 3 days from now (fixed weekdays failed on that weekday once its time had passed)
RG=$(api POST /api/one-to-one "{\"studentIds\":[\"$OS2\"],\"campusId\":\"$CAMPUS\",\"levelId\":\"$CVL\",\"plan\":\"PACKAGE\",\"sessions\":8,\"slots\":[{\"dayOfWeek\":$DW3,\"time\":\"03:00\",\"mode\":\"BRANCH\"}],\"teacherId\":\"$CALT\"}" | jq_ "d['data']['groupId']")
api PUT /api/one-to-one/settings '{"cancelHours":720}' >/dev/null
UPD=$(papi GET "/api/guardian-portal/one-to-one/sessions?studentId=$OS2" | jq_ "[s['date'] for b in d['data'] if b['id']=='$RG' for s in b['sessions']][0]")
check "too close to the session: the parent cannot move it" "$(papi POST /api/guardian-portal/one-to-one/sessions "{\"groupId\":\"$RG\",\"date\":\"$UPD\",\"newDate\":\"$(D 40)\",\"newTime\":\"05:15\"}" | jq_ "d['error']['code']")" "POSTPONE_REFUSED"
api PUT /api/one-to-one/settings '{"cancelHours":1}' >/dev/null
check "another family cannot touch it" "$(secapi GET /api/one-to-one/events >/dev/null; api POST /api/guardian-portal/one-to-one/sessions "{\"groupId\":\"$RG\",\"date\":\"$UPD\",\"newDate\":\"$(D 40)\",\"newTime\":\"05:15\"}" | jq_ "d['success']")" "False"
check "the parent moves a session: cancelled there, added on the new date" "$(papi POST /api/guardian-portal/one-to-one/sessions "{\"groupId\":\"$RG\",\"date\":\"$UPD\",\"newDate\":\"$(D 40)\",\"newTime\":\"05:15\"}" | jq_ "d['data']['left']")/$(M "SELECT COUNT(*) FROM CancelledSession WHERE classSectionId='$RG' AND date='$UPD'")/$(M "SELECT time FROM ExtraSession WHERE classSectionId='$RG' AND date='$(D 40)'")" "1/1/05:15"
check "a date in the past is refused" "$(papi POST /api/guardian-portal/one-to-one/sessions "{\"groupId\":\"$RG\",\"date\":\"$(papi GET "/api/guardian-portal/one-to-one/sessions?studentId=$OS2" | jq_ "[s['date'] for b in d['data'] if b['id']=='$RG' for s in b['sessions']][1]")\",\"newDate\":\"$(D -1)\",\"newTime\":\"05:15\"}" | jq_ "d['success']")" "False"
UP2=$(papi GET "/api/guardian-portal/one-to-one/sessions?studentId=$OS2" | jq_ "[s['date'] for b in d['data'] if b['id']=='$RG' for s in b['sessions'] if s['date']!='$(D 40)'][0]")
M "UPDATE OneToOneEvent SET date='$UPD' WHERE classSectionId='$RG'"
papi POST /api/guardian-portal/one-to-one/sessions "{\"groupId\":\"$RG\",\"date\":\"$UP2\",\"newDate\":\"$(D 41)\",\"newTime\":\"05:15\"}" >/dev/null
M "UPDATE OneToOneEvent SET date='$UPD' WHERE classSectionId='$RG'"
UP3=$(papi GET "/api/guardian-portal/one-to-one/sessions?studentId=$OS2" | jq_ "[s['date'] for b in d['data'] if b['id']=='$RG' for s in b['sessions'] if s['date'] not in ('$(D 40)','$(D 41)')][0]")
M "UPDATE OneToOneEvent SET date='$UP3' WHERE classSectionId='$RG'"
check "the month's postponements are used: the third is refused" "$(papi POST /api/guardian-portal/one-to-one/sessions "{\"groupId\":\"$RG\",\"date\":\"$UP3\",\"newDate\":\"$(D 42)\",\"newTime\":\"05:15\"}" | jq_ "d['error']['code']")" "POSTPONE_REFUSED"
check "staff can still move it outside the rules, and it is not counted for the family" "$(api POST /api/one-to-one/$RG/postpone "{\"date\":\"$UP3\",\"newDate\":\"$(D 42)\",\"newTime\":\"05:15\",\"override\":true}" | jq_ "d['success']")/$(M "SELECT countsAgainstParent FROM OneToOneEvent WHERE classSectionId='$RG' ORDER BY createdAt DESC LIMIT 1")" "True/0"
check "the instructor sees his sessions" "$(tapi GET /api/teacher-portal/one-to-one-offers/sessions | jq_ "any(g['id']=='$RG' and len(g['sessions'])>0 for g in d['data'])")" "True"
AP1=$(tapi GET /api/teacher-portal/one-to-one-offers/sessions | jq_ "[s['date'] for g in d['data'] if g['id']=='$RG' for s in g['sessions'] if s['date'] not in ('$(D 40)','$(D 41)','$(D 42)')][0]")
check "another instructor cannot apologise for it" "$(api POST /api/teacher-portal/one-to-one-offers/sessions "{\"groupId\":\"$RG\",\"date\":\"$AP1\",\"reason\":\"sick\"}" | jq_ "d['success']")" "False"
check "the instructor apologises: cancelled, family asked, staff task" "$(tapi POST /api/teacher-portal/one-to-one-offers/sessions "{\"groupId\":\"$RG\",\"date\":\"$AP1\",\"reason\":\"sick\"}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM CancelledSession WHERE classSectionId='$RG' AND date='$AP1'")/$(papi GET "/api/guardian-portal/one-to-one/sessions?studentId=$OS2" | jq_ "[a['date']=='$AP1' for b in d['data'] for a in b['apologies']]")/$(api GET /api/today | jq_ "any(t['key']=='oneToOneEvents' for t in d['data']['tasks'])")" "True/1/[True]/True"
EV1=$(M "SELECT id FROM OneToOneEvent WHERE classSectionId='$RG' AND kind='APOLOGY' AND date='$AP1'")
check "the family asks for a substitute; staff send it to one: back on, he must accept" "$(papi POST /api/guardian-portal/one-to-one/sessions "{\"eventId\":\"$EV1\",\"choice\":\"SUBSTITUTE\"}" | jq_ "d['success']")/$(M "SELECT state FROM OneToOneEvent WHERE id='$EV1'")/$(api PATCH /api/one-to-one/events/$EV1 "{\"action\":\"SUBSTITUTE\",\"teacherId\":\"$EW\"}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM CancelledSession WHERE classSectionId='$RG' AND date='$AP1'")/$(M "SELECT status FROM SubstituteAssignment WHERE classSectionId='$RG' AND date='$AP1'")" "True/WAITING_SUB/True/0/PENDING_SUBSTITUTE_APPROVAL"
AP2=$(tapi GET /api/teacher-portal/one-to-one-offers/sessions | jq_ "[s['date'] for g in d['data'] if g['id']=='$RG' for s in g['sessions'] if s['date'] not in ('$(D 40)','$(D 41)','$(D 42)','$AP1')][0]")
tapi POST /api/teacher-portal/one-to-one-offers/sessions "{\"groupId\":\"$RG\",\"date\":\"$AP2\",\"reason\":\"travel\"}" >/dev/null
EV2=$(M "SELECT id FROM OneToOneEvent WHERE classSectionId='$RG' AND kind='APOLOGY' AND date='$AP2'")
check "or a new date: added, and it does not use up the family's postponements" "$(papi POST /api/guardian-portal/one-to-one/sessions "{\"eventId\":\"$EV2\",\"choice\":\"POSTPONE\",\"newDate\":\"$(D 43)\",\"newTime\":\"05:15\"}" | jq_ "d['success']")/$(M "SELECT CONCAT(state,'/',countsAgainstParent) FROM OneToOneEvent WHERE id='$EV2'")/$(M "SELECT COUNT(*) FROM ExtraSession WHERE classSectionId='$RG' AND date='$(D 43)'")" "True/DONE/0/1"
check "answered twice: refused" "$(papi POST /api/guardian-portal/one-to-one/sessions "{\"eventId\":\"$EV2\",\"choice\":\"SUBSTITUTE\"}" | jq_ "d['success']")" "False"
check "the rules the parent accepts say all this" "$(api GET /api/groups/$RG/rules | PYTHONUTF8=1 jq_ "sum('One-to-One' in i['en'] for i in d['data']['items'])")" "4"
LWED=""; for i in 0 1 2 3 4 5 6; do [ -z "$LWED" ] && [ "$(cairo +%w -$i)" = "3" ] && LWED=$(D -$i); done
NEN=$(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$ODB' AND studentId='$OS3'")
api POST /api/enrollment-attendance "{\"classSectionId\":\"$ODB\",\"attendanceDate\":\"$LWED\",\"records\":[{\"studentEnrollmentId\":\"$NEN\",\"status\":\"ABSENT\"}]}" >/dev/null
M "UPDATE EnrollmentAttendanceRecord SET taughtByTeacherId='$CALT' WHERE studentEnrollmentId='$NEN'"
api PATCH /api/teachers/$CALT '{"defaultOneToOnePerSession":200}' >/dev/null
check "the student did not come: the instructor gets 50% of the session" "$(api GET "/api/teachers/$CALT/pay-statement?month=${LWED:0:7}&groupId=$ODB" | jq_ "[s['rate'] for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LWED']")" "[100]"
api PUT /api/one-to-one/settings '{"noShowPayPct":100}' >/dev/null
check "…or all of it (setting)" "$(api GET "/api/teachers/$CALT/pay-statement?month=${LWED:0:7}&groupId=$ODB" | jq_ "[s['rate'] for g in d['data']['groups'] for s in g['sessions'] if s['date']=='$LWED']")" "[200]"
api PUT /api/one-to-one/settings '{"noShowPayPct":50}' >/dev/null
check "one no-show keeps the fixed time while the limit is 3" "$(M "SELECT JSON_LENGTH(scheduleSlots) FROM ClassSection WHERE id='$ODB'")" "1"
api PUT /api/one-to-one/settings '{"noShowLimit":1}' >/dev/null
api POST /api/enrollment-attendance "{\"classSectionId\":\"$ODB\",\"attendanceDate\":\"$LWED\",\"records\":[{\"studentEnrollmentId\":\"$NEN\",\"status\":\"ABSENT\"}]}" >/dev/null
check "at the limit the fixed time is released, the student stays, family and staff told" "$(M "SELECT scheduleSlots IS NULL FROM ClassSection WHERE id='$ODB'")/$(M "SELECT status FROM StudentEnrollment WHERE id='$NEN'")/$(M "SELECT COUNT(*) FROM OneToOneEvent WHERE classSectionId='$ODB' AND kind='RELEASE'")/$(api GET /api/one-to-one/events | jq_ "any(e['groupId']=='$ODB' for e in d['data'])")" "1/ACTIVE/1/True"
api PUT /api/one-to-one/settings '{"noShowLimit":3}' >/dev/null
NTUE=$(api GET /api/one-to-one | jq_ "[u['date'] for r in d['data'] if r['id']=='$SG' for u in r['upcoming']][0]")
ONSCH() { api GET "/api/groups/schedule?from=$NTUE&to=$NTUE" | jq_ "sum(1 for o in d['data']['sessions'] if o['groupId']=='$SG' and o['status'] not in ('CANCELLED','HOLIDAY'))"; }
HN() { api POST /api/holidays "{\"date\":\"$NTUE\",\"name\":\"E2E 1:1 off\",\"appliesTo\":$1}" >/dev/null; }
check "before any holiday the One-to-One is on that day" "$(ONSCH)" "1"
HN '["BRANCH","ONLINE"]'
check "a holiday for branch and online sessions only leaves One-to-One working" "$(ONSCH)" "1"
M "DELETE FROM Holiday WHERE name='E2E 1:1 off'"
HN '["ONE_TO_ONE"]'
check "a holiday for One-to-One stops it" "$(ONSCH)" "0"
M "DELETE FROM Holiday WHERE name='E2E 1:1 off'"
echo "== 79. One-to-One: change time / instructor / length, hold, carry, instructor preference (a02 M3 batch 3 part 3, 2026-11-02)"
check "staff change the fixed time" "$(api PATCH /api/one-to-one/$RG '{"slots":[{"dayOfWeek":1,"time":"05:30","mode":"BRANCH"}]}' | jq_ "d['success']")/$(M "SELECT JSON_EXTRACT(scheduleSlots,'\$[0].dayOfWeek') FROM ClassSection WHERE id='$RG'")" "True/1"
check "…a clash with his other sessions is refused" "$(api PATCH /api/one-to-one/$RG '{"slots":[{"dayOfWeek":3,"time":"07:00","mode":"BRANCH"}]}' | jq_ "d['error']['code']")" "TEACHER_PROBLEM"
check "staff change the instructor" "$(api PATCH /api/one-to-one/$RG "{\"teacherId\":\"$EW\"}" | jq_ "d['success']")/$(M "SELECT teacherId='$EW' FROM SubjectOffering WHERE classSectionId='$RG'")" "True/1"
check "a released time: a new one is set and the note closes" "$(api PATCH /api/one-to-one/$ODB '{"slots":[{"dayOfWeek":4,"time":"05:30","mode":"BRANCH"}]}' | jq_ "d['success']")/$(M "SELECT JSON_LENGTH(scheduleSlots) FROM ClassSection WHERE id='$ODB'")/$(M "SELECT state FROM OneToOneEvent WHERE classSectionId='$ODB' AND kind='RELEASE'")" "True/1/DONE"
api POST /api/one-to-one/prices "{\"levelId\":\"$CVL\",\"plan\":\"PACKAGE\",\"sessions\":3,\"price\":750,\"minutes\":60}" >/dev/null
BK() { api POST /api/one-to-one "{\"studentIds\":[\"$OS3\"],\"campusId\":\"$CAMPUS\",\"levelId\":\"$CVL\",\"plan\":\"PACKAGE\",\"sessions\":3,\"slots\":[{\"dayOfWeek\":1,\"time\":\"$1\",\"mode\":\"BRANCH\"}],\"teacherId\":\"$CALT\"}"; }
SH1=$(BK 03:00 | jq_ "d['data']['groupId']")
check "a 60-minute One-to-One: stored with its length" "$(M "SELECT sessionMinutes FROM ClassSection WHERE id='$SH1'")" "60"
check "…an hour later is free (not the company's 90 minutes)" "$(BK 04:00 | jq_ "d['success']")" "True"
check "…half an hour later clashes" "$(BK 03:30 | jq_ "d['error']['code']")" "TEACHER_PROBLEM"
SHD=$(api GET /api/one-to-one | jq_ "[u['date'] for r in d['data'] if r['id']=='$SH1' for u in r['upcoming']][0]")
check "the length of one session can differ" "$(api POST /api/one-to-one/$SH1/length "{\"date\":\"$SHD\",\"minutes\":45}" | jq_ "d['success']")/$(api GET /api/one-to-one | jq_ "[u['minutes'] for r in d['data'] if r['id']=='$SH1' for u in r['upcoming'] if u['date']=='$SHD']")" "True/[45]"
check "the family asks for a change: staff see it; a second one waits" "$(papi POST /api/guardian-portal/one-to-one/change "{\"groupId\":\"$RG\",\"note\":\"Evening please\"}" | jq_ "d['success']")/$(api GET /api/one-to-one/events | jq_ "any(e['kind']=='CHANGE' and e['groupId']=='$RG' for e in d['data'])")/$(papi POST /api/guardian-portal/one-to-one/change "{\"groupId\":\"$RG\",\"note\":\"Again\"}" | jq_ "d['error']['code']")" "True/True/ALREADY_ASKED"
check "another family cannot ask" "$(papi POST /api/guardian-portal/one-to-one/change "{\"groupId\":\"$SH1\",\"note\":\"Evening\"}" | jq_ "d['success']")" "False"
check "renewing with sessions left waits for the month to pass" "$(api POST /api/one-to-one/$RG/renew '{"carry":true}' | jq_ "d['success']")" "False"
CEN=$(M "SELECT id FROM StudentEnrollment WHERE classSectionId='$RG' AND studentId='$OS2'")
LMON=""; for i in 0 1 2 3 4 5 6; do [ -z "$LMON" ] && [ "$(cairo +%w -$i)" = "1" ] && LMON=$(D -$i); done
api POST /api/enrollment-attendance "{\"classSectionId\":\"$RG\",\"attendanceDate\":\"$LMON\",\"records\":[{\"studentEnrollmentId\":\"$CEN\",\"status\":\"PRESENT\"}]}" >/dev/null
M "UPDATE ClassSection SET startDate=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY), currentCycleStartDate=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) WHERE id='$RG'"
M "UPDATE EnrollmentAttendanceRecord SET attendanceDate=DATE(DATE_SUB(UTC_TIMESTAMP(),INTERVAL 29 DAY)) WHERE studentEnrollmentId='$CEN'"
check "the list offers it after a month" "$(api GET /api/one-to-one | jq_ "[(r['canCarry'], r['sessionsLeft']) for r in d['data'] if r['id']=='$RG']")" "[(True, 7)]"
NC=$(api POST /api/one-to-one/$RG/renew '{"carry":true}' | jq_ "d['data']['newGroupId']")
check "next cycle carrying the 7 left: 8 + 7 sessions, billed one package, the old one finished" "$(M "SELECT CONCAT(cycleSessions,'/',carriedSessions,'/',ROUND(priceOverride)) FROM ClassSection WHERE id='$NC'")/$(inv $OS2 $NC | cut -d/ -f1)/$(M "SELECT status FROM ClassSection WHERE id='$RG'")" "15/7/1800/1800/COMPLETED"
api PUT /api/one-to-one/settings '{"carryMonths":0}' >/dev/null
check "carrying can be switched off" "$(api GET /api/one-to-one/settings | jq_ "d['data']['carryMonths']")" "0"
api PUT /api/one-to-one/settings '{"carryMonths":1}' >/dev/null
api PUT /api/one-to-one/settings '{"genderPreference":true}' >/dev/null
GP=$(papi GET "/api/guardian-portal/one-to-one?studentId=$OS1" | jq_ "d['data']['genderPreference']")
check "instructor preference: the parent can choose while the setting is on" "$GP" "True"
check "…nobody of that kind is free: refused at once" "$(papi POST /api/guardian-portal/one-to-one "{\"studentId\":\"$OS1\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":1,\"preferGender\":\"FEMALE\",\"slots\":[{\"dayOfWeek\":0,\"time\":\"05:00\",\"mode\":\"BRANCH\"}]}" | jq_ "d['error']['code']")" "NO_TEACHER"
api PUT /api/one-to-one/settings '{"genderPreference":false}' >/dev/null
RGO=$(papi POST /api/guardian-portal/one-to-one "{\"studentId\":\"$OS1\",\"levelId\":\"$CVL\",\"plan\":\"SESSION\",\"sessions\":1,\"preferGender\":\"FEMALE\",\"slots\":[{\"dayOfWeek\":0,\"time\":\"05:00\",\"mode\":\"BRANCH\"}]}" | jq_ "d['data']['id']")
check "…setting off: the preference is ignored" "$(M "SELECT CONCAT(state,'/',IFNULL(preferGender,'-')) FROM OneToOneRequest WHERE id='$RGO'")" "OFFERED/-"
papi DELETE /api/guardian-portal/one-to-one/$RGO >/dev/null
M "UPDATE Teacher SET isActive=0 WHERE id='$EW'"
check "an instructor left: a task for the staff" "$(api GET /api/today | jq_ "any(t['key']=='oneToOneNoTeacher' for t in d['data']['tasks'])")" "True"
M "UPDATE Teacher SET isActive=1 WHERE id='$EW'"
M "UPDATE EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId SET r.attendanceDate=DATE(DATE_SUB(UTC_TIMESTAMP(),INTERVAL 9 DAY)) WHERE e.classSectionId='$ODB'"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "a finished cycle not renewed after the hold days gives up its fixed time (daily job)" "$(M "SELECT scheduleSlots IS NULL FROM ClassSection WHERE id='$ODB'")/$(M "SELECT COUNT(*) FROM OneToOneEvent WHERE classSectionId='$ODB' AND note='Not renewed in time'")" "1/1"
echo "== 80. Small gaps closed: a room for one session, ways of a curriculum session, substitute says no, holiday list (a02 follow-up, 2026-11-02)"
api PUT /api/places/$DOTHER/rooms '{"roomMode":"FIXED"}' >/dev/null
GR1=$(api POST /api/places/$DOTHER/rooms '{"name":"E2E Gap Room A","capacity":10,"kind":"CLASSROOM"}' | jq_ "d['data']['id']")
GR2=$(api POST /api/places/$DOTHER/rooms '{"name":"E2E Gap Room B","capacity":10,"kind":"CLASSROOM"}' | jq_ "d['data']['id']")
GG1=$(api POST /api/groups "{\"campusId\":\"$DOTHER\",\"className\":\"E2E Gap One\",\"sectionName\":\"G\",\"levelId\":\"$CVL\"}" | jq_ "d['data']['id']")
GG2=$(api POST /api/groups "{\"campusId\":\"$DOTHER\",\"className\":\"E2E Gap Two\",\"sectionName\":\"G\",\"levelId\":\"$CVL\"}" | jq_ "d['data']['id']")
api PATCH /api/groups/$GG1 "{\"scheduleSlots\":[{\"dayOfWeek\":$DW3,\"time\":\"06:00\",\"mode\":\"BRANCH\",\"roomId\":\"$GR1\"}]}" >/dev/null
api PATCH /api/groups/$GG2 "{\"scheduleSlots\":[{\"dayOfWeek\":$DW3,\"time\":\"06:00\",\"mode\":\"BRANCH\",\"roomId\":\"$GR2\"}]}" >/dev/null
GTU=$(D 3)  # 3 days ahead: never today, so the session is always still to come
ROOMOF() { api GET "/api/groups/schedule?from=$GTU&to=$GTU" | PYTHONUTF8=1 jq_ "[o.get('room') for o in d['data']['sessions'] if o['groupId']=='$1']"; }
check "the calendar shows the room of a session" "$(ROOMOF $GG1)" "['E2E Gap Room A']"
check "one session in a room another group has then: refused" "$(api POST /api/groups/$GG1/session-room "{\"date\":\"$GTU\",\"roomId\":\"$GR2\"}" | jq_ "d['error']['code']")" "ROOM_PROBLEM"
GR3=$(api POST /api/places/$DOTHER/rooms '{"name":"E2E Gap Room C","capacity":10,"kind":"CLASSROOM"}' | jq_ "d['data']['id']")
check "one session in a free room: only that date moves" "$(api POST /api/groups/$GG1/session-room "{\"date\":\"$GTU\",\"roomId\":\"$GR3\"}" | jq_ "d['success']")/$(ROOMOF $GG1)" "True/['E2E Gap Room C']"
check "…the room it left is free for that session" "$(api POST /api/groups/$GG2/session-room "{\"date\":\"$GTU\",\"roomId\":\"$GR1\"}" | jq_ "d['success']")" "True"
check "back to its usual room" "$(api POST /api/groups/$GG1/session-room "{\"date\":\"$GTU\",\"roomId\":null}" | jq_ "d['success']")/$(ROOMOF $GG1)" "True/['E2E Gap Room A']"
check "a room of another place is refused" "$(api POST /api/groups/$GG1/session-room "{\"date\":\"$GTU\",\"roomId\":\"$RMR\"}" | jq_ "d['error']['code']")" "ROOM_PROBLEM"
check "a secretary of another place cannot do it" "$(secapi POST /api/groups/$GG1/session-room "{\"date\":\"$GTU\",\"roomId\":\"$GR3\"}" | jq_ "d['success']")" "False"
api PUT /api/places/$DOTHER/rooms '{"roomMode":"NONE"}' >/dev/null
check "a holiday in the list says who is off" "$(api POST /api/holidays "{\"date\":\"$(D 30)\",\"name\":\"E2E Gap Off\",\"appliesTo\":[\"ONLINE\"]}" >/dev/null; api GET "/api/holidays?from=$(D 30)&to=$(D 30)" | jq_ "[h['appliesTo'] for h in d['data'] if h['name']=='E2E Gap Off']")" "[['ONLINE']]"
M "DELETE FROM Holiday WHERE name='E2E Gap Off'"
GSD=$(api GET /api/one-to-one | jq_ "[u['date'] for r in d['data'] if r['id']=='$SH1' for u in r['upcoming']][1]")
M "INSERT INTO OneToOneEvent (id,classSectionId,date,kind,state,choice,countsAgainstParent,createdAt) VALUES ('e2e-gap-ev','$SH1','$GSD','APOLOGY','DONE','SUBSTITUTE',0,UTC_TIMESTAMP())"
M "INSERT INTO TeacherAbsence (id,teacherId,date,scope,classSectionId,reason,status,requestedAt) VALUES ('e2e-gap-ab','$CALT','$GSD','SINGLE_SESSION','$SH1','e2e','APPROVED',UTC_TIMESTAMP())"
M "INSERT INTO SubstituteAssignment (id,teacherAbsenceId,classSectionId,date,originalTeacherId,substituteTeacherId,assignedBy,assignedAt) VALUES ('e2e-gap-sa','e2e-gap-ab','$SH1','$GSD','$EW','$CALT','e2e',UTC_TIMESTAMP())"
check "the substitute says no: the apology goes back to the staff" "$(curl -s -b "$TJ76" -X POST -H 'Content-Type: application/json' -d '{"decision":"DECLINE"}' $B/api/substitute-assignments/e2e-gap-sa/respond | jq_ "d['success']")/$(M "SELECT state FROM OneToOneEvent WHERE id='e2e-gap-ev'")/$(api GET /api/one-to-one/events | jq_ "any(e['id']=='e2e-gap-ev' and e['state']=='WAITING_SUB' for e in d['data'])")" "True/WAITING_SUB/True"
M "DELETE FROM OneToOneEvent WHERE id='e2e-gap-ev'"
ES=$(M "SELECT s.id FROM CurriculumSession s JOIN CurriculumEdition e ON e.id=s.editionId WHERE e.levelId='$CVL' AND e.status='PUBLISHED' AND s.number=1 AND e.variantId IS NULL LIMIT 1")
GG3=$(api POST /api/groups "{\"campusId\":\"$CAMPUS\",\"className\":\"E2E Gap Three\",\"sectionName\":\"G\",\"levelId\":\"$CVL\"}" | jq_ "d['data']['id']")
api PATCH /api/groups/$GG3 "{\"scheduleSlots\":[{\"dayOfWeek\":$DW3,\"time\":\"05:00\",\"mode\":\"BRANCH\"}]}" >/dev/null
M "UPDATE CurriculumSession SET allowedModes='[\"BRANCH\"]' WHERE id='$ES'"
check "a curriculum session for the branch only: that session cannot go online" "$(api POST /api/groups/$GG3/session-mode "{\"date\":\"$GTU\",\"mode\":\"ONLINE\"}" | jq_ "d['error']['code']")" "MODE_NOT_ALLOWED"
M "UPDATE CurriculumSession SET allowedModes=NULL WHERE id='$ES'"
check "…with no such rule it can" "$(api POST /api/groups/$GG3/session-mode "{\"date\":\"$GTU\",\"mode\":\"ONLINE\"}" | jq_ "d['success']")" "True"
echo "== 81. Recorded courses: subscription, lock, progress, exam, certificate (a02 M4 batch 1, 2026-11-02)"
api PUT /api/platform/settings '{"modules":{"lms":true}}' >/dev/null
api POST /api/levels "{\"subjectId\":\"$SAC\",\"name\":\"Recorded Basics\",\"order\":5,\"numberOfMonths\":1,\"numberOfSessions\":2,\"pricingType\":\"FULL_LEVEL\",\"fullLevelPrice\":999}" >/dev/null
RL=$(M "SELECT id FROM Level WHERE name='Recorded Basics'")
RE=$(api POST /api/curriculum/levels/$RL '{"notes":"recorded"}' | jq_ "d['data']['id']")
RS1=$(M "SELECT id FROM CurriculumSession WHERE editionId='$RE' AND number=1"); RS2=$(M "SELECT id FROM CurriculumSession WHERE editionId='$RE' AND number=2")
RB1=$(api POST /api/curriculum/sessions/$RS1/blocks '{"type":"TEXT","data":{"textEn":"one","textAr":"واحد"}}' | jq_ "d['data']['id']")
RB2=$(api POST /api/curriculum/sessions/$RS2/blocks '{"type":"TEXT","data":{"textEn":"two","textAr":"اتنين"}}' | jq_ "d['data']['id']")
check "a secretary cannot change the catalogue" "$(secapi POST /api/recorded/courses "{\"levelId\":\"$RL\",\"oneTimePrice\":1}" | jq_ "d['success']")" "False"
check "a course needs a price" "$(api POST /api/recorded/courses "{\"levelId\":\"$RL\"}" | jq_ "d['success']")" "False"
check "a subscription needs its days" "$(api POST /api/recorded/courses "{\"levelId\":\"$RL\",\"subscriptionPrice\":300}" | jq_ "d['success']")" "False"
check "course saved: subscription 300 for 30 days, one-time 500, exam required by default" "$(api POST /api/recorded/courses "{\"levelId\":\"$RL\",\"subscriptionPrice\":300,\"subscriptionDays\":30,\"oneTimePrice\":500}" | jq_ "(float(d['data']['subscriptionPrice']), d['data']['subscriptionDays'], float(d['data']['oneTimePrice']), d['data']['examRequired'], d['data']['autoReveal'])")" "(300.0, 30, 500.0, True, False)"
RCOURSE() { api GET /api/recorded/courses | jq_ "[c['hasExam'] for c in d['data'] if c['levelId']=='$RL'][0]"; }
check "the catalogue warns: the exam is required and there is none yet" "$(RCOURSE)" "False"
RF=$(api POST /api/curriculum/sessions/$RS2/blocks '{"type":"QUIZ","titleEn":"Final","data":{"kind":"FINAL","attempts":3,"passMark":60,"questions":[{"id":"s1","type":"SINGLE","textEn":"Pick A","options":[{"id":"a","textEn":"A"},{"id":"b","textEn":"B"}],"correct":["a"],"points":1}]}}' | jq_ "d['data']['id']")
M "UPDATE CurriculumSession SET titleEn=CONCAT('Rec ',number) WHERE editionId='$RE' AND titleEn=''"
api PATCH /api/curriculum/editions/$RE '{"action":"submit"}' >/dev/null
check "curriculum published" "$(api PATCH /api/curriculum/editions/$RE '{"action":"publish"}' | jq_ "d['data']['status']")" "PUBLISHED"
check "…now the catalogue sees the exam" "$(RCOURSE)" "True"
RK=$(mkstu RecKid 01066660311 RecDad 01066660319); RK2=$(mkstu RecTwo 01066660312 RecDad2 01066660318); RK3=$(mkstu RecThree 01066660313 RecDad3 01066660317)
RENROL() { api POST /api/recorded "{\"studentId\":\"$1\",\"campusId\":\"$CAMPUS\",\"levelId\":\"$RL\",\"plan\":\"$2\"}"; }
check "a secretary of another place cannot enrol there" "$(secapi POST /api/recorded "{\"studentId\":\"$RK\",\"campusId\":\"$DOTHER\",\"levelId\":\"$RL\",\"plan\":\"SUBSCRIPTION\"}" | jq_ "d['success']")" "False"
RG=$(RENROL $RK SUBSCRIPTION | jq_ "d['data']['groupId']")
check "enrolled: one invoice of 300, kind RECORDED, one student, no instructor" "$(M "SELECT CONCAT(kind,'/',maxStudents,'/',cycleSessions) FROM ClassSection WHERE id='$RG'")/$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$RG'")/$(M "SELECT ROUND(totalAmount) FROM FeeInvoice WHERE classSectionId='$RG'")/$(M "SELECT COUNT(*) FROM SubjectOffering WHERE classSectionId='$RG'")" "RECORDED/1/2/1/300/0"
check "the same student cannot take it twice" "$(RENROL $RK SUBSCRIPTION | jq_ "d['error']['code']")" "ALREADY"
check "not on the Groups page or the attendance list" "$(api GET /api/groups | jq_ "'$RG' in str(d)")/$(api GET /api/class-sections | jq_ "'$RG' in str(d)")" "False/False"
check "data health does not call it a group without an instructor" "$(api GET /api/data-health | jq_ "'$RG' in str(d)")" "False"
RKR=$(api POST /api/students/$RK/portal-password '{"target":"student"}'); RKJ=$(mktemp); login_jar "$(echo "$RKR" | jq_ "d['data']['loginId']")" "$(echo "$RKR" | jq_ "d['data']['password']")" "$RKJ" 10.0.3.81
rget() { curl -s -b "$RKJ" "$B$1"; }
RTICK() { curl -s -b "$RKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$RG\",\"blockId\":\"$1\",\"done\":true}" $B/api/lessons/progress; }
RMY() { rget /api/lessons/my | jq_ "[(s['open'], s['lockedReason']['en'] if s['lockedReason'] else None) for g in d['data']['groups'] if g['group']['id']=='$RG' for s in g['sessions']][0]"; }
check "not paid: closed, with the reason" "$(RMY)" "(False, 'Opens when the invoice is paid')"
check "…the lesson itself is refused" "$(rget "/api/lessons/$RS1?g=$RG" | jq_ "d['error']['code']")" "LOCKED"
check "…and ticking too" "$(RTICK $RB1 | jq_ "d['success']")" "False"
check "…and the exam" "$(curl -s -b "$RKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$RG\",\"blockId\":\"$RF\"}" $B/api/quizzes/item | jq_ "d['success']")" "False"
pay "$(invid $RK $RG)" 300 >/dev/null
check "paid: all lessons open" "$(rget /api/lessons/my | jq_ "[s['open'] for g in d['data']['groups'] if g['group']['id']=='$RG' for s in g['sessions']]")" "[True, True]"
check "the 30 days start from the payment" "$(M "SELECT DATEDIFF(accessEndsAt, UTC_TIMESTAMP()) BETWEEN 29 AND 30 FROM ClassSection WHERE id='$RG'")" "1"
check "the student sees until when" "$(rget /api/lessons/my | jq_ "[g['access']['state'] for g in d['data']['groups'] if g['group']['id']=='$RG'][0]")" "OPEN"
check "lesson opens and a tick counts" "$(rget "/api/lessons/$RS1?g=$RG" | jq_ "d['success']")/$(RTICK $RB1 | jq_ "d['success']")" "True/True"
RLIST() { api GET /api/recorded | jq_ "[$1 for r in d['data'] if r['id']=='$2'][0]"; }
check "staff list: progress 1 of 3 (2 lessons + the exam)" "$(RLIST "(r['state'], r['progress']['done'], r['progress']['total'], r['progress']['pct'])" $RG)" "('OPEN', 1, 3, 33)"
RTICK $RB2 >/dev/null
check "the exam starts with no instructor to open it" "$(curl -s -b "$RKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$RG\",\"blockId\":\"$RF\"}" $B/api/quizzes/item | jq_ "d['success']")/$(rget "/api/quizzes/item?g=$RG&b=$RF" | jq_ "d['data']['needsOpen']")" "True/False"
RA=$(rget "/api/quizzes/item?g=$RG&b=$RF" | jq_ "d['data']['active']['id']")
RPUT() { curl -s -b "$RKJ" -X PUT -H 'Content-Type: application/json' -d "$2" $B/api/quizzes/attempts/$1; }
RPUT $RA '{"answers":{"s1":"b"},"submit":true}' >/dev/null
RCERT() { M "SELECT COUNT(*) FROM Certificate WHERE studentId='$1' AND remarks='RECORDED:$RL'"; }
check "failed the exam: every lesson done, no certificate" "$(RLIST "(r['progress']['done'], r['progress']['examScore'], r['progress']['certificate'])" $RG)/$(RCERT $RK)" "(3, 0, None)/0"
curl -s -b "$RKJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$RG\",\"blockId\":\"$RF\"}" $B/api/quizzes/item >/dev/null
RA=$(rget "/api/quizzes/item?g=$RG&b=$RF" | jq_ "d['data']['active']['id']")
RPUT $RA '{"answers":{"s1":"a"},"submit":true}' >/dev/null
check "passed: the certificate is made, hidden, with a TN-CERT number" "$(RCERT $RK)/$(M "SELECT CONCAT(isRevealed,'/',type,'/',LEFT(certificateNumber,8)) FROM Certificate WHERE studentId='$RK' AND remarks='RECORDED:$RL'")" "1/0/COMPLETION/TN-CERT-"
check "…the student sees it only as waiting to be revealed" "$(rget /api/certificates/mine | jq_ "[c['isRevealed'] for c in d['data'] if c['remarks']=='RECORDED:$RL']")" "[False]"
rget /api/lessons/my >/dev/null; RTICK $RB1 >/dev/null
check "…and never a second one" "$(RCERT $RK)" "1"
M "UPDATE ClassSection SET accessEndsAt=UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id='$RG'"
check "subscription ended: closed, says the progress is kept" "$(RMY)" "(False, 'The subscription ended; renew it to continue. Your progress is kept.')"
check "…the progress really is kept" "$(M "SELECT COUNT(*) FROM LessonProgress WHERE studentId='$RK' AND classSectionId='$RG'")" "3"
RK4=$(mkstu RecFour 01066660314 RecDad4 01066660316); RG4=$(api POST /api/recorded "{\"studentId\":\"$RK4\",\"campusId\":\"$DOTHER\",\"levelId\":\"$RL\",\"plan\":\"SUBSCRIPTION\"}" | jq_ "d['data']['groupId']")
check "a secretary of another place cannot renew or see it" "$(secapi POST /api/recorded/$RG4/renew '{}' | jq_ "d['success']")/$(secapi GET /api/recorded | jq_ "'$RG4' in str(d)")" "False/False"
check "renew: a new invoice, still closed until it is paid" "$(api POST /api/recorded/$RG/renew '{}' | jq_ "d['data']['period']")/$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$RG'")/$(RMY)" "2/2/(False, 'The subscription ended; renew it to continue. Your progress is kept.')"
check "…no second renewal before it is paid" "$(api POST /api/recorded/$RG/renew '{}' | jq_ "d['error']['code']")" "NOT_PAID"
pay "$(M "SELECT id FROM FeeInvoice WHERE classSectionId='$RG' AND cycleNumber=2")" 300 >/dev/null
check "…paid: open again for 30 days from today" "$(rget /api/lessons/my | jq_ "[s['open'] for g in d['data']['groups'] if g['group']['id']=='$RG' for s in g['sessions']]")/$(M "SELECT DATEDIFF(accessEndsAt, UTC_TIMESTAMP()) BETWEEN 29 AND 30 FROM ClassSection WHERE id='$RG'")" "[True, True]/1"
M "UPDATE ClassSection SET accessEndsAt=UTC_TIMESTAMP() + INTERVAL 62 HOUR WHERE id='$RG'"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "daily job: the family hears 3 days before the end, in Arabic" "$(M "SELECT COUNT(*) FROM Notification n JOIN Guardian g ON g.userId=n.userId WHERE g.phoneNumber='01066660319' AND n.titleAr='الاشتراك قرب يخلص'")" "1"
check "today list counts subscriptions ending this week" "$(api GET /api/today | jq_ "[t['count'] for t in d['data']['tasks'] if t['key']=='recordedEnding'][0]>=1")" "True"
RG2=$(RENROL $RK2 ONE_TIME | jq_ "d['data']['groupId']")
pay "$(invid $RK2 $RG2)" 500 >/dev/null
RSTATE() { api GET /api/recorded | jq_ "[r['state'] for r in d['data'] if r['id']=='$1'][0]"; }
check "one-time purchase: open with no end date" "$(RSTATE $RG2)/$(M "SELECT accessEndsAt IS NULL FROM ClassSection WHERE id='$RG2'")" "OPEN/1"
check "…it has nothing to renew" "$(api POST /api/recorded/$RG2/renew '{}' | jq_ "d['success']")" "False"
M "UPDATE FeeInvoice SET refundedAmount=paidAmount WHERE classSectionId='$RG2'"
check "…all the money refunded: closed" "$(RSTATE $RG2)" "NOT_PAID"
M "UPDATE FeeInvoice SET refundedAmount=0 WHERE classSectionId='$RG2'"
api POST /api/recorded/courses "{\"levelId\":\"$RL\",\"subscriptionPrice\":300,\"subscriptionDays\":30,\"oneTimePrice\":0,\"examRequired\":false,\"autoReveal\":true}" >/dev/null
RG3=$(RENROL $RK3 ONE_TIME | jq_ "d['data']['groupId']")
check "a free course: open at once, no invoice" "$(RSTATE $RG3)/$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$RG3'")" "OPEN/0"
RK3R=$(api POST /api/students/$RK3/portal-password '{"target":"student"}'); RK3J=$(mktemp); login_jar "$(echo "$RK3R" | jq_ "d['data']['loginId']")" "$(echo "$RK3R" | jq_ "d['data']['password']")" "$RK3J" 10.0.3.82
for b in $RB1 $RB2 $RF; do curl -s -b "$RK3J" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$RG3\",\"blockId\":\"$b\",\"done\":true}" $B/api/lessons/progress >/dev/null; done
check "exam not required + show at once: the certificate is visible when the lessons end" "$(M "SELECT isRevealed FROM Certificate WHERE studentId='$RK3' AND remarks='RECORDED:$RL'")/$(curl -s -b "$RK3J" $B/api/certificates/mine | jq_ "str(d).count('TN-CERT')>0")" "1/True"
check "a recorded course is not moved like a group" "$(api POST /api/students/$RK/transfer "{\"fromClassSectionId\":\"$RG\",\"toClassSectionId\":\"$GG3\",\"creditTo\":\"WALLET\"}" | jq_ "'not moved like a group' in str(d)")" "True"
rm -f "$RKJ" "$RK3J"
echo "== 82. Protected videos: encrypted pieces, short-lived key, device limit, paid courses (a02 M4 batch 3, 2026-11-02)"
VDIR=$(mktemp -d)
VPLAY() { curl -s -b "$1" -X POST -H 'Content-Type: application/json' -d "{\"blockId\":\"$2\",\"g\":\"$3\",\"device\":\"$4\"}" $B/api/videos/play; }
check "a secretary cannot start an upload" "$(secapi POST /api/videos '{"name":"x.mp4"}' | jq_ "d['success']")" "False"
VU=$(api POST /api/videos '{"name":"lesson.mp4"}')
VID=$(echo "$VU" | jq_ "d['data']['id']"); VKEY=$(echo "$VU" | jq_ "d['data']['key']"); VIV=$(echo "$VU" | jq_ "d['data']['iv']")
check "an upload starts on the local store of this copy" "$(echo "$VU" | jq_ "d['data']['mode']")/${#VKEY}/${#VIV}" "local/32/32"
check "the stored key is sealed, not the plain key" "$(M "SELECT keySealed LIKE '%$VKEY%' FROM ProtectedVideo WHERE id='$VID'")/$(M "SELECT status FROM ProtectedVideo WHERE id='$VID'")" "0/UPLOADING"
( cd "$VDIR" && ffmpeg -y -v error -f lavfi -i "testsrc2=size=320x180:rate=15" -f lavfi -i "sine=frequency=440" -t 20 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 15 -c:a aac in.mp4 \
  && python -c "open('k.bin','wb').write(bytes.fromhex('$VKEY'))" && printf 'KEY_URI\nk.bin\n%s\n' "$VIV" > k.info \
  && ffmpeg -y -v error -i in.mp4 -c copy -f hls -hls_time 6 -hls_playlist_type vod -hls_key_info_file k.info -hls_segment_filename 'p%05d.ts' index.m3u8 )
VJSON() { python -c "import json,sys;print(json.dumps({'manifest':open(sys.argv[1]).read(),'sizeBytes':1000}))" "$VDIR/index.m3u8"; }
check "a list without encryption is refused" "$(python -c "import json;print(json.dumps({'manifest':'#EXTM3U\n#EXTINF:6.0,\np00000.ts\n#EXT-X-ENDLIST\n','sizeBytes':1}))" > "$VDIR/bad.json"; curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$VDIR/bad.json" $B/api/videos/$VID/complete | jq_ "d['success']")" "False"
VJSON > "$VDIR/ok.json"
check "finishing before the pieces arrive is refused" "$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$VDIR/ok.json" $B/api/videos/$VID/complete | jq_ "d['error']['code']")" "PIECES_MISSING"
check "a strange piece name is refused" "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -X PUT --data-binary 'x' "$B/api/videos/$VID/piece/key.bin")" "403"
for f in "$VDIR"/p*.ts; do curl -s -o /dev/null -b "$JAR" -X PUT --data-binary @"$f" "$B/api/videos/$VID/piece/$(basename "$f")"; done
check "ready after every piece is up" "$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$VDIR/ok.json" $B/api/videos/$VID/complete | jq_ "d['data']['durationSec']")/$(M "SELECT status FROM ProtectedVideo WHERE id='$VID'")" "20/READY"
check "a finished video cannot be overwritten" "$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d @"$VDIR/ok.json" $B/api/videos/$VID/complete | jq_ "d['success']")" "False"
curl -s -o "$VDIR/stolen.ts" $B/api/videos/p/$VID/p00001.ts
check "a piece can be fetched with no login, but it is not video" "$(python -c "import sys;b=open(sys.argv[1],'rb').read();print(len(b)>500, b[0]==0x47 and b[188]==0x47)" "$VDIR/stolen.ts")" "True False"
check "…and a player cannot open it" "$(ffmpeg -v error -i "$VDIR/stolen.ts" -f null - >/dev/null 2>&1 && echo opened || echo refused)" "refused"
api POST /api/levels "{\"subjectId\":\"$SAC\",\"name\":\"Protected Basics\",\"order\":6,\"numberOfMonths\":1,\"numberOfSessions\":1,\"pricingType\":\"FULL_LEVEL\",\"fullLevelPrice\":999}" >/dev/null
VL=$(M "SELECT id FROM Level WHERE name='Protected Basics'")
VE=$(api POST /api/curriculum/levels/$VL '{"notes":"videos"}' | jq_ "d['data']['id']"); VS=$(M "SELECT id FROM CurriculumSession WHERE editionId='$VE' AND number=1")
VB=$(api POST /api/curriculum/sessions/$VS/blocks "{\"type\":\"VIDEO\",\"data\":{\"protected\":{\"videoId\":\"$VID\",\"name\":\"lesson.mp4\",\"durationSec\":20}}}" | jq_ "d['data']['id']")
check "a protected video goes in a lesson" "$(M "SELECT type FROM CurriculumBlock WHERE id='$VB'")" "VIDEO"
M "UPDATE CurriculumSession SET titleEn='Video lesson' WHERE id='$VS'"
api PATCH /api/curriculum/editions/$VE '{"action":"submit"}' >/dev/null; api PATCH /api/curriculum/editions/$VE '{"action":"publish"}' >/dev/null
api POST /api/levels "{\"subjectId\":\"$SAC\",\"name\":\"Link Basics\",\"order\":7,\"numberOfMonths\":1,\"numberOfSessions\":1,\"pricingType\":\"FULL_LEVEL\",\"fullLevelPrice\":999}" >/dev/null
VL2=$(M "SELECT id FROM Level WHERE name='Link Basics'")
VE2=$(api POST /api/curriculum/levels/$VL2 '{"notes":"link"}' | jq_ "d['data']['id']"); VS2=$(M "SELECT id FROM CurriculumSession WHERE editionId='$VE2' AND number=1")
api POST /api/curriculum/sessions/$VS2/blocks '{"type":"VIDEO","data":{"url":"https://youtu.be/dQw4w9WgXcQ"}}' >/dev/null
M "UPDATE CurriculumSession SET titleEn='Link lesson' WHERE id='$VS2'"
api PATCH /api/curriculum/editions/$VE2 '{"action":"submit"}' >/dev/null; api PATCH /api/curriculum/editions/$VE2 '{"action":"publish"}' >/dev/null
api POST /api/recorded/courses "{\"levelId\":\"$VL2\",\"subscriptionPrice\":100,\"subscriptionDays\":30}" >/dev/null
api POST /api/recorded/courses "{\"levelId\":\"$VL\",\"subscriptionPrice\":200,\"subscriptionDays\":30}" >/dev/null
VK=$(mkstu VidKid 01066660411 VidDad 01066660419); VK2=$(mkstu VidOther 01066660412 VidDad2 01066660418)
VENROL() { api POST /api/recorded "{\"studentId\":\"$1\",\"campusId\":\"$CAMPUS\",\"levelId\":\"$2\",\"plan\":\"SUBSCRIPTION\"}"; }
check "the catalogue counts the video that is not protected" "$(api GET /api/recorded/courses | jq_ "sorted((c['levelId']=='$VL2', c['unprotectedVideos']) for c in d['data'] if c['levelId'] in ('$VL','$VL2'))")" "[(False, 0), (True, 1)]"
check "a paid course with a YouTube link refuses enrolling" "$(VENROL $VK $VL2 | jq_ "d['error']['code']")" "UNPROTECTED_VIDEO"
check "a secretary cannot change the video settings" "$(secapi PUT /api/videos/settings '{"deviceLimit":5}' | jq_ "d['success']")" "False"
api PUT /api/videos/settings '{"blockUnprotectedPaid":false}' >/dev/null
check "…the setting can allow it" "$(VENROL $VK2 $VL2 | jq_ "d['success']")" "True"
api PUT /api/videos/settings '{"blockUnprotectedPaid":true}' >/dev/null
VG=$(VENROL $VK $VL | jq_ "d['data']['groupId']")
VKR=$(api POST /api/students/$VK/portal-password '{"target":"student"}'); VJ=$(mktemp); login_jar "$(echo "$VKR" | jq_ "d['data']['loginId']")" "$(echo "$VKR" | jq_ "d['data']['password']")" "$VJ" 10.0.4.81
VK2R=$(api POST /api/students/$VK2/portal-password '{"target":"student"}'); VJ2=$(mktemp); login_jar "$(echo "$VK2R" | jq_ "d['data']['loginId']")" "$(echo "$VK2R" | jq_ "d['data']['password']")" "$VJ2" 10.0.4.82
check "not paid: the video is refused" "$(VPLAY "$VJ" $VB $VG dev-a | jq_ "d['success']")" "False"
pay "$(invid $VK $VG)" 200 >/dev/null
V1=$(VPLAY "$VJ" $VB $VG dev-a)
VT=$(echo "$V1" | jq_ "d['data']['token']")
check "paid: it opens, with the student's name and number for the picture" "$(echo "$V1" | jq_ "'VidKid' in d['data']['name'] and 'TN/' in d['data']['name']")" "True"
check "the lesson data has no key and no piece links" "$(curl -s -b "$VJ" "$B/api/lessons/$VS?g=$VG" | jq_ "[('key' in str(b['data']).lower(), 'p00000' in str(b['data']), b['data']['videoRef']['g']=='$VG') for b in d['data']['blocks']]")" "[(False, False, True)]"
check "another student cannot start it" "$(VPLAY "$VJ2" $VB $VG dev-z | jq_ "d['success']")" "False"
check "the list carries a key link for this viewing" "$(curl -s -b "$VJ" $B/api/videos/m/$VT | python -c "import sys;t=sys.stdin.read();print('/api/videos/k/$VT' in t, 'KEY_URI' in t, '/api/videos/p/$VID/p00000.ts' in t)")" "True False True"
VKEYHEX() { curl -s -b "$1" "$B/api/videos/k/$2" | python -c "import sys;print(sys.stdin.buffer.read().hex())"; }
check "the key that comes back is the real one" "$(VKEYHEX "$VJ" $VT)" "$VKEY"
check "with no login: no key and no list" "$(curl -s -o /dev/null -w '%{http_code}' $B/api/videos/k/$VT)/$(curl -s -o /dev/null -w '%{http_code}' $B/api/videos/m/$VT)" "401/401"
check "another person with the link gets nothing" "$(curl -s -o /dev/null -w '%{http_code}' -b "$VJ2" $B/api/videos/k/$VT)/$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $B/api/videos/k/$VT)" "403/403"
check "a made-up link gets nothing" "$(curl -s -o /dev/null -w '%{http_code}' -b "$VJ" $B/api/videos/k/nothing)" "403"
check "each key request is counted" "$(M "SELECT keyFetches FROM VideoViewing WHERE studentId='$VK' AND refused=0 ORDER BY startedAt DESC LIMIT 1")" "1"
VPLAY "$VJ" $VB $VG dev-b >/dev/null
check "a third device is refused while the limit is 2" "$(VPLAY "$VJ" $VB $VG dev-c | jq_ "d['error']['code']")" "DEVICE_LIMIT"
check "the same device reopening is fine, and its old link dies" "$(V2=$(VPLAY "$VJ" $VB $VG dev-a); VT2=$(echo "$V2" | jq_ "d['data']['token']"); echo "$(curl -s -o /dev/null -w '%{http_code}' -b "$VJ" $B/api/videos/m/$VT)/$(curl -s -o /dev/null -w '%{http_code}' -b "$VJ" $B/api/videos/m/$VT2)")" "403/200"
check "the setting changes the number" "$(api PUT /api/videos/settings '{"deviceLimit":3}' | jq_ "d['data']['deviceLimit']")/$(VPLAY "$VJ" $VB $VG dev-c | jq_ "d['success']")/$(VPLAY "$VJ" $VB $VG dev-d | jq_ "d['error']['code']")" "3/True/DEVICE_LIMIT"
api PUT /api/videos/settings '{"deviceLimit":2}' >/dev/null
api POST /api/recorded/courses "{\"levelId\":\"$VL\",\"subscriptionPrice\":200,\"subscriptionDays\":30,\"videoDevices\":4}" >/dev/null
check "a course can have its own number" "$(VPLAY "$VJ" $VB $VG dev-d | jq_ "d['success']")" "True"
VDEND=$(VPLAY "$VJ" $VB $VG dev-d | jq_ "d['data']['token']")
curl -s -b "$VJ" -X POST -d "{\"token\":\"$VDEND\",\"end\":true}" $B/api/videos/heartbeat >/dev/null
check "closing the player frees the device" "$(M "SELECT COUNT(*) FROM VideoViewing WHERE studentId='$VK' AND device='dev-d' AND refused=0 AND lastSeenAt > UTC_TIMESTAMP() - INTERVAL 1 MINUTE")" "0"
VT3=$(VPLAY "$VJ" $VB $VG dev-a | jq_ "d['data']['token']")
check "a sign of life keeps the link" "$(curl -s -b "$VJ" -X POST -d "{\"token\":\"$VT3\"}" $B/api/videos/heartbeat | jq_ "d['success']")" "True"
M "UPDATE VideoViewing SET expiresAt=UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE studentId='$VK' AND device='dev-a' AND refused=0"
check "an old link stops: list, key and sign of life" "$(curl -s -o /dev/null -w '%{http_code}' -b "$VJ" $B/api/videos/m/$VT3)/$(curl -s -o /dev/null -w '%{http_code}' -b "$VJ" $B/api/videos/k/$VT3)/$(curl -s -o /dev/null -w '%{http_code}' -b "$VJ" -X POST -d "{\"token\":\"$VT3\"}" $B/api/videos/heartbeat)" "403/403/403"
VT4=$(VPLAY "$VJ" $VB $VG dev-a | jq_ "d['data']['token']")
M "UPDATE ClassSection SET accessEndsAt=UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id='$VG'"
check "the subscription ended: a live link gets no key, and no new viewing" "$(curl -s -b "$VJ" $B/api/videos/k/$VT4 | jq_ "d['error']['code']")/$(VPLAY "$VJ" $VB $VG dev-a | jq_ "d['success']")" "LOCKED/False"
M "UPDATE ClassSection SET accessEndsAt=UTC_TIMESTAMP() + INTERVAL 5 DAY WHERE id='$VG'"
ADMPLAY=$(curl -s -b "$JAR" -X POST -H 'Content-Type: application/json' -d "{\"blockId\":\"$VB\",\"device\":\"staff-1\"}" $B/api/videos/play)
check "staff can preview it from the curriculum" "$(echo "$ADMPLAY" | jq_ "d['success']")/$(VKEYHEX "$JAR" "$(echo "$ADMPLAY" | jq_ "d['data']['token']")")" "True/$VKEY"
check "nothing unusual yet" "$(api GET /api/videos/watch | jq_ "'$VK' in str(d['data'])")" "False"
api PUT /api/videos/settings '{"deviceLimit":1}' >/dev/null
api POST /api/recorded/courses "{\"levelId\":\"$VL\",\"subscriptionPrice\":200,\"subscriptionDays\":30}" >/dev/null
for i in 1 2 3 4 5 6; do VPLAY "$VJ" $VB $VG "dev-x$i" >/dev/null; done
check "many refused devices show on the watching list" "$(api GET /api/videos/watch | jq_ "[w['refused']>=5 for w in d['data'] if w['studentId']=='$VK']")" "[True]"
check "…and in today's work" "$(api GET /api/today | jq_ "any(t['key']=='videoSuspicious' for t in d['data']['tasks'])")" "True"
check "a secretary cannot read the watching list" "$(secapi GET /api/videos/watch | jq_ "d['success']")" "False"
check "the video list shows it with its viewings" "$(api GET /api/videos | jq_ "[(v['status'], v['viewings']>0) for v in d['data'] if v['id']=='$VID']")" "[('READY', True)]"
api PUT /api/videos/settings '{"deviceLimit":2}' >/dev/null
rm -rf "$VDIR" "$VJ" "$VJ2"
echo "== 83. Recorded courses: refund counts lessons, parent renews, a video can be removed (2026-11-03)"
api POST /api/levels "{\"subjectId\":\"$SAC\",\"name\":\"Refund Basics\",\"order\":8,\"numberOfMonths\":1,\"numberOfSessions\":4,\"pricingType\":\"FULL_LEVEL\",\"fullLevelPrice\":999}" >/dev/null
GL=$(M "SELECT id FROM Level WHERE name='Refund Basics'")
GE=$(api POST /api/curriculum/levels/$GL '{"notes":"gaps"}' | jq_ "d['data']['id']")
M "UPDATE CurriculumSession SET titleEn=CONCAT('Gap ',number) WHERE editionId='$GE'"
GS1=$(M "SELECT id FROM CurriculumSession WHERE editionId='$GE' AND number=1")
GB1=$(api POST /api/curriculum/sessions/$GS1/blocks '{"type":"TEXT","data":{"textEn":"one","textAr":"واحد"}}' | jq_ "d['data']['id']")
api PATCH /api/curriculum/editions/$GE '{"action":"submit"}' >/dev/null; api PATCH /api/curriculum/editions/$GE '{"action":"publish"}' >/dev/null
api POST /api/recorded/courses "{\"levelId\":\"$GL\",\"subscriptionPrice\":400,\"subscriptionDays\":30,\"oneTimePrice\":800}" >/dev/null
GK=$(mkstu GapKid 01066660511 GapDad 01066660519)
GG=$(api POST /api/recorded "{\"studentId\":\"$GK\",\"campusId\":\"$CAMPUS\",\"levelId\":\"$GL\",\"plan\":\"SUBSCRIPTION\"}" | jq_ "d['data']['groupId']")
pay "$(invid $GK $GG)" 400 >/dev/null
GKR=$(api POST /api/students/$GK/portal-password '{"target":"student"}'); GJ=$(mktemp); login_jar "$(echo "$GKR" | jq_ "d['data']['loginId']")" "$(echo "$GKR" | jq_ "d['data']['password']")" "$GJ" 10.0.5.81
GSUG() { api GET "/api/refunds/suggest?invoiceId=$1" | jq_ "(d['data']['basis'], d['data']['sessionsCounted'], float(d['data']['suggested']))"; }
GI1=$(invid $GK $GG)
check "refund before any lesson: all of it back, minus the 10% admin fee of the rule" "$(GSUG $GI1)" "('OPENED', 0, 360.0)"
curl -s -b "$GJ" -X POST -H 'Content-Type: application/json' -d "{\"groupId\":\"$GG\",\"blockId\":\"$GB1\",\"done\":true}" $B/api/lessons/progress >/dev/null
check "one lesson of four opened: a quarter and the admin fee come off" "$(GSUG $GI1)" "('OPENED', 1, 260.0)"
M "UPDATE ClassSection SET accessEndsAt=UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id='$GG'"
check "the period is over: nothing to give back" "$(GSUG $GI1)" "('OPENED', 4, 0.0)"
GPW=$(M "SELECT g.id FROM Guardian g WHERE g.phoneNumber='01066660519'")
GPR=$(api POST /api/students/$GK/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$GPW\"}" | jq_ "d['data']['password']"); GPJ=$(mktemp); login_jar 01066660519 "$GPR" "$GPJ" 10.0.5.82
GP() { curl -s -b "$GPJ" "$B/api/guardian-portal/recorded?studentId=$GK"; }
GREN() { curl -s -b "$1" -X POST -H 'Content-Type: application/json' -d "{\"studentId\":\"$GK\",\"groupId\":\"$GG\"}" $B/api/guardian-portal/recorded; }
check "the parent sees it ended, with the price to renew" "$(GP | jq_ "[(c['state'], c['canRenew'], c['price'], c['days'], c['progress']['done']) for c in d['data']]")" "[('EXPIRED', True, 400, 30, 1)]"
check "the student cannot renew" "$(GREN "$GJ" | jq_ "d['success']")" "False"
check "another parent cannot renew" "$(GREN "$LPJ" | jq_ "d['success']")" "False"
check "another parent cannot read it" "$(curl -s -b "$LPJ" "$B/api/guardian-portal/recorded?studentId=$GK" | jq_ "d['success']")" "False"
check "the parent renews: an invoice, still closed" "$(GREN "$GPJ" | jq_ "d['data']['period']")/$(M "SELECT COUNT(*) FROM FeeInvoice WHERE classSectionId='$GG'")/$(GP | jq_ "[(c['state'], c['canRenew'], c['unpaidRenewal']) for c in d['data']]")" "2/2/[('EXPIRED', False, True)]"
check "…not a second time before it is paid" "$(GREN "$GPJ" | jq_ "d['error']['code']")" "NOT_PAID"
GI2=$(M "SELECT id FROM FeeInvoice WHERE classSectionId='$GG' AND cycleNumber=2")
pay "$GI2" 400 >/dev/null
check "paid: open again" "$(GP | jq_ "[c['state'] for c in d['data']]")" "['OPEN']"
check "a lesson of the old period does not count on the new invoice" "$(GSUG $GI2)" "('OPENED', 0, 360.0)"
check "…and the old invoice stays used up" "$(GSUG $GI1)" "('OPENED', 4, 0.0)"
api POST /api/recorded/courses "{\"levelId\":\"$GL\",\"subscriptionPrice\":400,\"subscriptionDays\":30,\"isActive\":false}" >/dev/null
M "UPDATE ClassSection SET accessEndsAt=UTC_TIMESTAMP() - INTERVAL 1 DAY WHERE id='$GG'"
check "a stopped course cannot be renewed by the parent" "$(GREN "$GPJ" | jq_ "d['error']['code']")" "NOT_A_COURSE"
check "a normal group refund still counts attendance" "$(api GET "/api/refunds/suggest?invoiceId=$LATEINV" | jq_ "d['data']['basis'] in ('ATTENDED','HELD')")" "True"
check "a secretary cannot remove a finished video" "$(secapi DELETE /api/videos/$VID | jq_ "d['success']")" "False"
check "a video a lesson uses cannot be removed" "$(api DELETE /api/videos/$VID | jq_ "d['error']['code']")" "IN_USE"
check "the list says where it is used" "$(api GET /api/videos | jq_ "[v['uses'] for v in d['data'] if v['id']=='$VID']")" "[1]"
GV=$(api POST /api/videos '{"name":"unused.mp4"}' | jq_ "d['data']['id']")
curl -s -o /dev/null -b "$JAR" -X PUT --data-binary 'x' "$B/api/videos/$GV/piece/p00000.ts"
check "an unfinished upload: its piece is on the store" "$(curl -s -o /dev/null -w '%{http_code}' $B/api/videos/p/$GV/p00000.ts)" "200"
check "…removing it removes the piece and the row" "$(api DELETE /api/videos/$GV | jq_ "d['success']")/$(curl -s -o /dev/null -w '%{http_code}' $B/api/videos/p/$GV/p00000.ts)/$(M "SELECT COUNT(*) FROM ProtectedVideo WHERE id='$GV'")" "True/404/0"
GV2=$(api POST /api/videos '{"name":"old.mp4"}' | jq_ "d['data']['id']")
M "UPDATE ProtectedVideo SET createdAt=UTC_TIMESTAMP() - INTERVAL 8 DAY WHERE id='$GV2'"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "the daily job clears uploads left for a week" "$(M "SELECT COUNT(*) FROM ProtectedVideo WHERE id='$GV2'")" "0"
GKEEP=$(api GET /api/refunds/rules)
GALLOWED() { api GET "/api/refunds/suggest?invoiceId=$1" | jq_ "d['data']['allowed']"; }
check "refunds are open for a recorded course by default" "$(GALLOWED $GI2)" "True"
api PUT /api/refunds/rules "$(echo "$GKEEP" | python -c "import sys,json;rs=json.load(sys.stdin)['data'];print(json.dumps({'rules':[{k:r.get(k) for k in ('scopeType','scopeId','allowed','adminFeeType','adminFeeValue','deductBasis','untilDaysBeforeFirst')} for r in rs]+[{'scopeType':'RECORDED','allowed':False,'adminFeeType':'FIXED','adminFeeValue':0,'deductBasis':'ATTENDED'}]}))")" >/dev/null
check "closing refunds for recorded courses closes this one" "$(GALLOWED $GI2)" "False"
check "…a request is refused" "$(api POST /api/refunds "{\"invoiceId\":\"$GI2\",\"amount\":10,\"method\":\"CASH\",\"reason\":\"e2e\"}" | jq_ "d['success']")" "False"
check "…a normal group is not affected" "$(GALLOWED $LATEINV)" "$(echo "$GKEEP" | python -c "import sys,json;print(all(r['allowed'] for r in json.load(sys.stdin)['data'] if r['scopeType']=='ALL'))")"
api PUT /api/refunds/rules "$(echo "$GKEEP" | python -c "import sys,json;rs=json.load(sys.stdin)['data'];print(json.dumps({'rules':[{k:r.get(k) for k in ('scopeType','scopeId','allowed','adminFeeType','adminFeeValue','deductBasis','untilDaysBeforeFirst')} for r in rs]}))")" >/dev/null
rm -f "$GJ" "$GPJ"
echo "== 84. Security part 1: staff passwords, no data loss on build, alerts to the Super Admin (2026-11-06)"
SECN() { M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'تنبيه أمان:%' AND n.titleAr LIKE '%$1%'"; }
check "a short staff password is refused" "$(api POST /api/users/create-admin "{\"firstName\":\"Weak\",\"lastName\":\"Pass\",\"email\":\"weak@e2e.local\",\"password\":\"Abc12345\",\"role\":\"SECRETARY\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['success']")" "False"
check "…letters only is refused too" "$(api POST /api/users/create-admin "{\"firstName\":\"Weak\",\"lastName\":\"Pass\",\"email\":\"weak@e2e.local\",\"password\":\"abcdefghijkl\",\"role\":\"SECRETARY\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['success']")" "False"
N0=$(SECN 'مدير جديد')
check "a new admin account is made with a good password" "$(api POST /api/users/create-admin "{\"firstName\":\"Sec\",\"lastName\":\"Admin\",\"email\":\"secadmin@e2e.local\",\"password\":\"Strong2026Pass\",\"role\":\"ADMIN\",\"campusId\":\"$CAMPUS\"}" | jq_ "d['success']")" "True"
check "…and every Super Admin is told" "$(( $(SECN 'مدير جديد') > N0 ))" "1"
SAU=$(M "SELECT id FROM User WHERE email='secadmin@e2e.local'")
check "resetting an admin's password to a short one is refused" "$(api POST /api/users/reset-credentials "{\"userId\":\"$SAU\",\"newPassword\":\"short1\"}" | jq_ "d['success']")" "False"
N1=$(SECN 'باسورد أو إيميل')
api POST /api/users/reset-credentials "{\"userId\":\"$SAU\",\"newPassword\":\"Another2026Pass\"}" >/dev/null
check "…a good one works and the Super Admin is told" "$(( $(SECN 'باسورد أو إيميل') > N1 ))" "1"
check "the build no longer drops data by itself" "$(grep -c "'--accept-data-loss', '--skip-generate'" scripts/db-push-with-timeout.js)/$(grep -c 'DB_PUSH_ALLOW_DATA_LOSS' scripts/db-push-with-timeout.js)" "0/2"
check "no known fallback secret is left in the code" "$(grep -rln "dev-secret-key-change-in-production\|'dev-only-secret'" lib app --include=*.ts | grep -v lib/security/secret.ts | wc -l | tr -d ' ')" "0"
G88=$(M "SELECT userId FROM Guardian WHERE phoneNumber='01066660519'")
check "a parent may still use an 8-character password" "$(api POST /api/users/reset-credentials "{\"userId\":\"$G88\",\"newPassword\":\"Parent88\"}" | jq_ "d['success']")" "True"
echo "== 85. Security part 2: two-step sign-in (on / off, roles, spare codes, reset), idle sign-out (2026-11-06)"
TOTP() { python -c "import sys,hmac,hashlib,struct,time,base64;s=sys.argv[1];k=base64.b32decode(s+'='*(-len(s)%8));t=int(time.time()//30)+int(sys.argv[2]);m=hmac.new(k,struct.pack('>Q',t),hashlib.sha1).digest();o=m[-1]&15;print('%06d'%((struct.unpack('>I',m[o:o+4])[0]&0x7fffffff)%1000000))" "$1" "${2:-0}"; }
LOGIN_OTP() { # email pw otp jar ip -> Location header
  local t; t=$(curl -s -c "$4" -b "$4" -H "X-Forwarded-For: $5" $B/api/auth/csrf | jq_ "d['csrfToken']")
  curl -s -o /dev/null -D - -c "$4" -b "$4" -H "X-Forwarded-For: $5" -X POST $B/api/auth/callback/credentials --data-urlencode "csrfToken=$t" --data-urlencode "email=$1" --data-urlencode "password=$2" --data-urlencode "otp=$3" --data-urlencode "callbackUrl=$B/dashboard" | grep -i '^location' | tr -d '\r'
}
check "a secretary cannot read or change the sign-in security settings" "$(secapi GET /api/security/settings | jq_ "d['success']")/$(secapi PUT /api/security/settings '{"twoFactorEnabled":true}' | jq_ "d['success']")" "False/False"
check "two-step sign-in switched on for Super Admin and Admin" "$(api PUT /api/security/settings '{"twoFactorEnabled":true,"twoFactorRoles":["SUPER_ADMIN","ADMIN"],"idleMinutes":30}' | jq_ "(d['data']['twoFactorEnabled'], d['data']['twoFactorRoles'])")" "(True, ['SUPER_ADMIN', 'ADMIN'])"
TA=$(mktemp); M "DELETE FROM LoginAttempt"
LOGIN_OTP secadmin@e2e.local Another2026Pass "" "$TA" 10.0.8.51 >/dev/null
check "an admin without the app signs in but must set it up: other APIs refuse" "$(curl -s -b "$TA" $B/api/auth/session | jq_ "d['user']['twoFactorSetup']")/$(curl -s -b "$TA" "$B/api/students?limit=1" | jq_ "d['error']['code']")" "True/TWO_FACTOR_SETUP"
check "…and pages open the setup page" "$(curl -s -o /dev/null -D - -b "$TA" $B/dashboard/students | grep -i '^location' | grep -c setup-2fa)" "1"
check "my status says required, not on yet" "$(curl -s -b "$TA" $B/api/security/two-factor | jq_ "(d['data']['required'], d['data']['enabled'])")" "(True, False)"
ST=$(curl -s -b "$TA" -X POST -H 'Content-Type: application/json' -d '{"action":"start"}' $B/api/security/two-factor)
SEC=$(echo "$ST" | jq_ "d['data']['secret']")
check "setup gives a secret and a QR picture" "$(echo "$ST" | jq_ "(len(d['data']['secret'])>=32, d['data']['qr'].startswith('data:image/png'), d['data']['url'].startswith('otpauth://totp/TechNova'))")" "(True, True, True)"
check "the secret is stored sealed, never as typed" "$(M "SELECT totpSecret LIKE '%$SEC%' FROM User WHERE email='secadmin@e2e.local'")" "0"
check "a wrong first code is refused" "$(curl -s -b "$TA" -X POST -H 'Content-Type: application/json' -d '{"action":"confirm","code":"000000"}' $B/api/security/two-factor | jq_ "d['success']")" "False"
CF=$(curl -s -b "$TA" -X POST -H 'Content-Type: application/json' -d "{\"action\":\"confirm\",\"code\":\"$(TOTP "$SEC")\"}" $B/api/security/two-factor)
SP1=$(echo "$CF" | jq_ "d['data']['spares'][0]"); SP2=$(echo "$CF" | jq_ "d['data']['spares'][1]")
check "the right code turns it on with 8 spare codes, and the session ends" "$(echo "$CF" | jq_ "len(d['data']['spares'])")/$(curl -s -o /dev/null -w '%{http_code}' -b "$TA" $B/api/security/two-factor)" "8/401"
check "the spare codes are stored only as hashes" "$(M "SELECT totpRecovery LIKE '%$SP1%' FROM User WHERE email='secadmin@e2e.local'")" "0"
M "DELETE FROM LoginAttempt"
check "password only: the login page asks for the code" "$(LOGIN_OTP secadmin@e2e.local Another2026Pass "" "$(mktemp)" 10.0.8.52 | grep -c 'code=otp_required')" "1"
check "a wrong code is refused" "$(LOGIN_OTP secadmin@e2e.local Another2026Pass 111111 "$(mktemp)" 10.0.8.53 | grep -c 'code=otp_invalid')" "1"
check "a wrong code counts like a wrong password" "$(M "SELECT COUNT(*) FROM LoginAttempt")" "1"
TB=$(mktemp); C1=$(TOTP "$SEC" 1) # the next step: the one used to turn it on is spent
LOGIN_OTP secadmin@e2e.local Another2026Pass "$C1" "$TB" 10.0.8.54 >/dev/null
check "password + the right code: signed in, nothing more to set up" "$(curl -s -b "$TB" $B/api/auth/session | jq_ "(d['user']['email'], d['user']['twoFactorSetup'])")/$(curl -s -b "$TB" "$B/api/students?limit=1" | jq_ "d['success']")" "('secadmin@e2e.local', False)/True"
check "the same code cannot be used twice" "$(LOGIN_OTP secadmin@e2e.local Another2026Pass "$C1" "$(mktemp)" 10.0.8.55 | grep -c 'code=otp_invalid')" "1"
M "DELETE FROM LoginAttempt"
TC=$(mktemp); LOGIN_OTP secadmin@e2e.local Another2026Pass "$SP1" "$TC" 10.0.8.56 >/dev/null
check "a spare code works once" "$(curl -s -b "$TC" $B/api/auth/session | jq_ "d['user']['email']")/$(LOGIN_OTP secadmin@e2e.local Another2026Pass "$SP1" "$(mktemp)" 10.0.8.57 | grep -c 'code=otp_invalid')" "secadmin@e2e.local/1"
check "…and it was counted down" "$(curl -s -b "$TC" $B/api/security/two-factor | jq_ "d['data']['sparesLeft']")" "7"
check "a secretary does not need it (not a required role)" "$(curl -s -b "$SECJ" "$B/api/students?limit=1" | jq_ "d['success']")" "True"
check "the staff list shows who has it" "$(api GET /api/security/two-factor/users | jq_ "[(r['totpEnabledAt'] is not None, r['required']) for r in d['data'] if r['email']=='secadmin@e2e.local']")" "[(True, True)]"
SAID=$(M "SELECT id FROM User WHERE email='secadmin@e2e.local'")
check "only a Super Admin can reset it" "$(secapi POST /api/security/two-factor/users "{\"userId\":\"$SAID\"}" | jq_ "d['success']")" "False"
N5=$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'تنبيه أمان:%'")
check "a Super Admin resets it (lost phone): the person is signed out and told about" "$(api POST /api/security/two-factor/users "{\"userId\":\"$SAID\"}" | jq_ "d['success']")/$(curl -s -o /dev/null -w '%{http_code}' -b "$TB" "$B/api/students?limit=1")/$(( $(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'تنبيه أمان:%'") > N5 ))" "True/401/1"
TD=$(mktemp); M "DELETE FROM LoginAttempt"; LOGIN_OTP secadmin@e2e.local Another2026Pass "" "$TD" 10.0.8.58 >/dev/null
check "…next sign-in: set it up again" "$(curl -s -b "$TD" $B/api/auth/session | jq_ "d['user']['twoFactorSetup']")" "True"
IPJ=$(mktemp); login_jar 01066660519 Parent88 "$IPJ" 10.0.8.60
check "idle sign-out: 30 minutes for staff, never for families" "$(api GET /api/security/policy | jq_ "d['data']['idleMinutes']")/$(curl -s -b "$IPJ" $B/api/security/policy | jq_ "d['data']['idleMinutes']")" "30/0"
N6=$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'تنبيه أمان:%'")
check "switching it off: the Super Admin is told, and nobody is asked any more" "$(api PUT /api/security/settings '{"twoFactorEnabled":false}' | jq_ "d['data']['twoFactorEnabled']")/$(( $(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'تنبيه أمان:%'") > N6 ))" "False/1"
M "DELETE FROM LoginAttempt"
check "…with it off the reset admin signs in with the password only" "$(TE=$(mktemp); LOGIN_OTP secadmin@e2e.local Another2026Pass "" "$TE" 10.0.8.59 >/dev/null; curl -s -b "$TE" "$B/api/students?limit=1" | jq_ "d['success']")" "True"
api PUT /api/security/settings '{"idleMinutes":0}' >/dev/null
rm -f "$TA" "$TB" "$TC" "$TD"
echo "== 86. Security part 3: HSTS + page protection (CSP watch mode + report log), old template screens Super Admin only (2026-11-07)"
HD=$(curl -s -o /dev/null -D - $B/login | tr -d '\r')
check "pages send HSTS and the page protection in watch mode" "$(echo "$HD" | grep -ci '^strict-transport-security: max-age=63072000')/$(echo "$HD" | grep -ci '^content-security-policy-report-only:.*object-src .none.')/$(echo "$HD" | grep -ci '^content-security-policy:')" "1/1/0"
check "the JSON APIs do not carry it (H5P keeps its own frame rule)" "$(curl -s -o /dev/null -D - $B/api/public/policies | grep -ci '^content-security-policy')" "0"
M "DELETE FROM CspReport"
curl -s -o /dev/null -X POST -H 'Content-Type: application/csp-report' -d '{"csp-report":{"document-uri":"http://x/dashboard/students?tab=2","violated-directive":"script-src-elem","blocked-uri":"https://evil.example/a.js?token=SECRET123"}}' $B/api/security/csp-report
CR=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/reports+json' -d '[{"type":"csp-violation","body":{"documentURL":"http://x/dashboard/students","effectiveDirective":"script-src-elem","blockedURL":"https://evil.example/b.js"}}]' $B/api/security/csp-report)
check "the browser can report without signing in (both formats), the same place is counted once" "$CR/$(M "SELECT CONCAT(COUNT(*),':',MAX(count)) FROM CspReport")" "204/1:2"
check "only the place is kept, never the link with its token" "$(M "SELECT CONCAT(blocked,' ',page) FROM CspReport")/$(M "SELECT COUNT(*) FROM CspReport WHERE blocked LIKE '%SECRET%' OR page LIKE '%tab=%'")" "https://evil.example /dashboard/students/0"
check "junk is ignored quietly" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d 'not json' $B/api/security/csp-report)/$(M "SELECT COUNT(*) FROM CspReport")" "204/1"
check "the Super Admin sees the list (watch mode); a secretary cannot" "$(api GET /api/security/csp-report | jq_ "(d['data']['enforced'], d['data']['rows'][0]['blocked'], d['data']['rows'][0]['count'])")/$(secapi GET /api/security/csp-report | jq_ "d['success']")/$(secapi DELETE /api/security/csp-report | jq_ "d['success']")" "(False, 'https://evil.example', 2)/False/False"
check "the Super Admin clears the list" "$(api DELETE /api/security/csp-report | jq_ "d['data']['removed']")/$(M "SELECT COUNT(*) FROM CspReport")" "1/0"
check "old template APIs are closed for a secretary" "$(secapi GET /api/timetable | jq_ "d['error']['code']")/$(secapi GET /api/exams | jq_ "d['error']['code']")/$(secapi POST /api/academic/bootstrap '{}' | jq_ "d['error']['code']")" "LEGACY_LOCKED/LEGACY_LOCKED/LEGACY_LOCKED"
TJ6=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ6" 10.0.8.71
check "…and for an instructor (old tasks / results / attendance)" "$(curl -s -b "$TJ6" $B/api/teacher-portal/tasks | jq_ "d['error']['code']")/$(curl -s -b "$TJ6" $B/api/teacher-portal/results | jq_ "d['error']['code']")/$(curl -s -b "$TJ6" $B/api/teacher-portal/attendance | jq_ "d['error']['code']")" "LEGACY_LOCKED/LEGACY_LOCKED/LEGACY_LOCKED"
check "the instructor's active screens still work (groups, attendance roster list)" "$(curl -s -b "$TJ6" $B/api/teacher-portal/sections | jq_ "d['success']")/$(curl -s -b "$TJ6" $B/api/teachers/profile | jq_ "d['success']")" "True/True"
NOTOLD="d.get('error',{}).get('code','') != 'LEGACY_LOCKED'"
check "shared APIs the active screens use are not closed for a secretary" "$(secapi GET /api/class-sections | jq_ "$NOTOLD")/$(secapi GET /api/academic-years | jq_ "$NOTOLD")/$(secapi GET /api/campuses | jq_ "$NOTOLD")/$(secapi GET /api/rooms/settings | jq_ "$NOTOLD")" "True/True/True/True"
check "old pages send a secretary / instructor home" "$(curl -s -o /dev/null -D - -b "$SECJ" $B/dashboard/timetable | grep -i '^location' | tr -d '\r' | sed 's#^[Ll]ocation: ##; s#^https\?://[^/]*##')/$(curl -s -o /dev/null -D - -b "$TJ6" $B/dashboard/teacher/grade-entry | grep -i '^location' | tr -d '\r' | sed 's#^[Ll]ocation: ##; s#^https\?://[^/]*##')" "/dashboard//dashboard/teacher"
check "…but the Super Admin still opens them, and the old API answers him" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $B/dashboard/timetable)/$(api GET /api/timetable | jq_ "$NOTOLD")" "200/True"
check "an active page next to an old one is not closed" "$(curl -s -o /dev/null -w '%{http_code}' -b "$SECJ" $B/dashboard/students)" "200"
rm -f "$TJ6"
echo "== 87. Cancel a payment recorded by mistake: request, another person approves, everything undone (2026-11-07)"
VI=$(M "SELECT i.id FROM FeeInvoice i WHERE i.status IN ('ISSUED','OVERDUE') AND i.paidAmount=0 AND i.refundedAmount=0 AND i.totalAmount>0 AND i.classSectionId IS NOT NULL ORDER BY i.createdAt DESC LIMIT 1")
VAMT=$(M "SELECT totalAmount FROM FeeInvoice WHERE id='$VI'"); VST=$(M "SELECT studentId FROM FeeInvoice WHERE id='$VI'")
VSP0=$(M "SELECT paidAmount FROM Student WHERE id='$VST'"); VSD0=$(M "SELECT dueAmount FROM Student WHERE id='$VST'")
VW0=$(M "SELECT COALESCE(SUM(amount),0) FROM WalletTransaction WHERE studentId='$VST'")
pay "$VI" "$VAMT" >/dev/null
VP=$(M "SELECT id FROM FeePayment WHERE invoiceId='$VI' ORDER BY createdAt DESC LIMIT 1")
api GET /api/treasury >/dev/null
check "a cash payment was recorded (wallet lines + cash-box movement)" "$(M "SELECT status FROM FeeInvoice WHERE id='$VI'")/$(M "SELECT COUNT(*) FROM WalletTransaction WHERE paymentId='$VP' OR topUpId IN (SELECT id FROM WalletTopUp WHERE paymentId='$VP')")/$(M "SELECT COUNT(*) FROM MoneyMovement WHERE feePaymentId='$VP'")" "PAID/2/1"
check "the receipt can be cancelled (button check)" "$(api GET "/api/payment-voids/check?paymentId=$VP" | jq_ "d['data']['possible']")" "True"
check "a reason is required" "$(api POST /api/payment-voids "{\"paymentId\":\"$VP\",\"reason\":\"x\"}" | jq_ "d['success']")" "False"
VR=$(api POST /api/payment-voids "{\"paymentId\":\"$VP\",\"reason\":\"Saved twice by mistake\"}")
VID=$(echo "$VR" | jq_ "d['data']['id']")
check "the request waits; the payment still counts until it is approved" "$(echo "$VR" | jq_ "d['data']['state']")/$(M "SELECT status FROM FeePayment WHERE id='$VP'")" "PENDING/COMPLETED"
check "only one request at a time" "$(api POST /api/payment-voids "{\"paymentId\":\"$VP\",\"reason\":\"Saved twice by mistake\"}" | jq_ "d['error']['code']")" "PENDING"
check "the person who asked cannot approve it (not even the Super Admin)" "$(api PATCH /api/payment-voids/$VID '{"action":"approve"}' | jq_ "d['error']['code']")" "OWN_REQUEST"
check "a secretary cannot approve it" "$(secapi PATCH /api/payment-voids/$VID '{"action":"approve"}' | jq_ "d['success']")" "False"
M "UPDATE User SET allLocations=1 WHERE email='secadmin@e2e.local'"; M "DELETE FROM LoginAttempt"
VAJ=$(mktemp); login_jar secadmin@e2e.local Another2026Pass "$VAJ" 10.0.8.81
vadm() { curl -s -b "$VAJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
check "the approvers are told, and it is in their work today" "$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.email='secadmin@e2e.local' AND n.type='PAYMENT_VOID_REQUEST' AND n.relatedId='$VID'")/$(vadm GET /api/today | TK "t.get('paymentVoids',0)>=1")" "1/True"
NV=$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'تنبيه أمان:%'")
check "another person (an admin) approves" "$(vadm PATCH /api/payment-voids/$VID '{"action":"approve","note":"checked the cash box"}' | jq_ "d['data']['state']")" "APPROVED"
check "the payment is cancelled, the invoice is due again" "$(M "SELECT CONCAT(status,'/',voidedAt IS NOT NULL) FROM FeePayment WHERE id='$VP'")/$(M "SELECT CONCAT(FLOOR(paidAmount),'/',status) FROM FeeInvoice WHERE id='$VI'" | sed 's#/ISSUED#/DUE#; s#/OVERDUE#/DUE#')" "VOIDED/1/0/DUE"
check "the student's summary is back as before" "$(M "SELECT paidAmount FROM Student WHERE id='$VST'")/$(M "SELECT dueAmount FROM Student WHERE id='$VST'")" "$VSP0/$(python -c "a=float('$VAMT');d=float('$VSD0');print('%.2f' % (max(0,d-a)+a))")"
check "wallet lines gone, the top-up marked cancelled, the wallet balance unchanged" "$(M "SELECT COUNT(*) FROM WalletTransaction WHERE paymentId='$VP'")/$(M "SELECT status FROM WalletTopUp WHERE paymentId='$VP'")/$(M "SELECT COALESCE(SUM(amount),0) FROM WalletTransaction WHERE studentId='$VST'")" "0/VOIDED/$VW0"
check "the cash-box movement is gone and never comes back" "$(M "SELECT COUNT(*) FROM MoneyMovement WHERE feePaymentId='$VP'")/$(api GET /api/treasury >/dev/null; M "SELECT COUNT(*) FROM MoneyMovement WHERE feePaymentId='$VP'")" "0/0"
check "the receipt shows CANCELLED; it cannot be cancelled twice" "$(api GET /api/payments/$VP/receipt | jq_ "d['data']['status']")/$(api GET "/api/payment-voids/check?paymentId=$VP" | jq_ "d['data']['possible']")" "VOIDED/False"
check "the Super Admin gets a security alert; the request log keeps who and why" "$(( $(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'تنبيه أمان:%'") > NV ))/$(api GET '/api/payment-voids?status=ALL' | jq_ "[(r['reason'], r['decisionNote'], r['decidedBy'] is not None) for r in d['data'] if r['id']=='$VID'][0]")" "1/('Saved twice by mistake', 'checked the cash box', True)"
check "the invoice can be paid again normally" "$(pay "$VI" "$VAMT" | jq_ "d['success']")/$(M "SELECT status FROM FeeInvoice WHERE id='$VI'")" "True/PAID"
VP2=$(M "SELECT id FROM FeePayment WHERE invoiceId='$VI' AND status='COMPLETED' ORDER BY createdAt DESC LIMIT 1")
M "UPDATE FeePayment SET source='ONLINE' WHERE id='$VP2'"
check "an online payment cannot be cancelled (refund it)" "$(api POST /api/payment-voids "{\"paymentId\":\"$VP2\",\"reason\":\"wrong student here\"}" | jq_ "d['error']['code']")" "ONLINE"
M "UPDATE FeePayment SET source='STAFF', createdAt=NOW() - INTERVAL 8 DAY WHERE id='$VP2'"
check "after 7 days it cannot be cancelled (refund it)" "$(api POST /api/payment-voids "{\"paymentId\":\"$VP2\",\"reason\":\"wrong student here\"}" | jq_ "d['error']['code']")" "TOO_OLD"
check "the days are a setting (approvers only)" "$(secapi PUT /api/payment-voids/settings '{"maxDays":10}' | jq_ "d['success']")/$(api PUT /api/payment-voids/settings '{"maxDays":10}' | jq_ "d['data']['maxDays']")/$(api POST /api/payment-voids "{\"paymentId\":\"$VP2\",\"reason\":\"wrong student here\"}" | jq_ "d['data']['state']")" "False/10/PENDING"
VID2=$(M "SELECT id FROM PaymentVoid WHERE paymentId='$VP2' AND status='PENDING'")
check "refused: the payment stays, the person who asked is told" "$(vadm PATCH /api/payment-voids/$VID2 '{"action":"reject","note":"the money is in the box"}' | jq_ "d['data']['state']")/$(M "SELECT status FROM FeePayment WHERE id='$VP2'")/$(M "SELECT status FROM FeeInvoice WHERE id='$VI'")/$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.type='PAYMENT_VOID_REQUEST' AND n.relatedId='$VID2'")" "REJECTED/COMPLETED/PAID/1"
VR3=$(api POST /api/payment-voids "{\"paymentId\":\"$VP2\",\"reason\":\"asked again by mistake\"}" | jq_ "d['data']['id']")
check "the person who asked can withdraw a request" "$(api PATCH /api/payment-voids/$VR3 '{"action":"reject"}' | jq_ "d['data']['state']")/$(M "SELECT status FROM FeePayment WHERE id='$VP2'")" "REJECTED/COMPLETED"
api PUT /api/payment-voids/settings '{"maxDays":7}' >/dev/null
M "UPDATE FeePayment SET createdAt=NOW() WHERE id='$VP2'"
rm -f "$VAJ"
echo "== 88. Duplicate-student warning: the same child is not registered twice by mistake (2026-11-07)"
DK=$(mkstu Dupkid 01000000881 Dparent 01000000882)
check "a new child is saved normally" "$( [ -n "$DK" ] && echo ok)" "ok"
DR=$(api POST /api/students "$(stu Dupkid 01000000883 Dparent +201000000882)")
check "same name + same parent phone (written +20…): refused with the old record shown" "$(echo "$DR" | jq_ "(d['error']['code'], d['error']['details'][0]['id']=='$DK', d['error']['details'][0]['level'])")" "('DUPLICATE_SUSPECT', True, 'SURE')"
check "…the check the form calls says the same" "$(api POST /api/students/duplicates '{"firstName":"dupkid","lastName":"e2e","phones":["1000000882"]}' | jq_ "[(c['id']=='$DK', c['level']) for c in d['data']]")" "[(True, 'SURE')]"
check "a brother / sister (same parent phone, another name) is not a duplicate" "$(api POST /api/students "$(stu Dupsib 01000000884 Dparent 01000000882)" | jq_ "d['success']")" "True"
check "staff confirm it is another child: saved" "$(api POST /api/students "$(stu Dupkid 01000000885 Dparent 01000000882 | sed 's/}$/,"confirmNotDuplicate":true}/')" | jq_ "d['success']")" "True"
AK=$(mkstu "\u0623\u062d\u0645\u062f" 01000000886 "Aparent" 01000000887)
check "Arabic names: أحمد and احمد are the same name (sent as \u codes: Git Bash breaks Arabic in curl)" "$(api POST /api/students "$(stu "\u0627\u062d\u0645\u062f" 01000000888 Aparent 01000000887)" | jq_ "d['error']['code']")" "DUPLICATE_SUSPECT"
M "UPDATE Student SET enrollmentStatus='WITHDRAWN' WHERE id='$AK'"
check "an old (withdrawn) child is found too (re-add the old record instead)" "$(api POST /api/students/duplicates '{"firstName":"\u0623\u062d\u0645\u062f","lastName":"E2e","phones":["01000000887"]}' | jq_ "[(c['id']=='$AK', c['status']) for c in d['data']]")" "[(True, 'WITHDRAWN')]"
TJ8=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ8" 10.0.8.90
check "an instructor cannot run the check" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ8" -X POST -H 'Content-Type: application/json' -d '{"firstName":"x","phones":[]}' $B/api/students/duplicates)" "403"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.8.88' -d '{"firstName":"Dupkid","lastName":"E2e","fullNameAr":"طفل مكرر","fatherName":"Dparent","dateOfBirth":"2015-01-01","gender":"MALE","address":"Sheraton street, Hurghada","city":"Hurghada","phoneNumber":"01000000889","emergencyContact":"01000000882","guardianFirstName":"Dparent","guardianLastName":"E2e","guardianPhoneNumber":"01000000882","guardianRelationship":"Father","preferredCampusId":"","preferredShift":"","deliveryMode":"PHYSICAL","termsAccepted":true}' $B/api/admissions/apply
DAR=$(M "SELECT id FROM AdmissionRequest WHERE firstName='Dupkid' AND status='PENDING' LIMIT 1")
check "approving an online application for a child already registered asks first" "$(api POST /api/admissions/$DAR/approve "{\"campusId\":\"$CAMPUS\"}" | jq_ "d['error']['code']")/$(M "SELECT status FROM AdmissionRequest WHERE id='$DAR'")" "DUPLICATE_SUSPECT/PENDING"
check "…and approves it when staff say it is another child" "$(api POST /api/admissions/$DAR/approve "{\"campusId\":\"$CAMPUS\",\"confirmNotDuplicate\":true}" | jq_ "d['success']")/$(M "SELECT status FROM AdmissionRequest WHERE id='$DAR'")" "True/APPROVED"
echo "== 89. Months of a group: every billing cycle opens from the group window (b03, 2026-11-08)"
MA=$(M "SELECT l.classSectionId FROM GroupCycleLog l JOIN FeeInvoice i ON i.classSectionId=l.classSectionId WHERE l.newClassSectionId IS NOT NULL ORDER BY l.completedAt DESC LIMIT 1")
MB=$(M "SELECT newClassSectionId FROM GroupCycleLog WHERE classSectionId='$MA' AND newClassSectionId IS NOT NULL ORDER BY completedAt DESC LIMIT 1")
MF=$(api GET /api/groups/$MA/months); MT=$(api GET /api/groups/$MB/months)
check "the old month and the new month show the same list, in order" "$(echo "$MF" | jq_ "[m['id'] for m in d['data']['months']]==$(echo "$MT" | jq_ "[m['id'] for m in d['data']['months']]")")/$(echo "$MF" | jq_ "(lambda i: i.index('$MA')<i.index('$MB'))([m['id'] for m in d['data']['months']])")" "True/True"
check "the group opened is the one marked" "$(echo "$MF" | jq_ "[m['id'] for m in d['data']['months'] if m['current']]==['$MA']")/$(echo "$MT" | jq_ "[m['id'] for m in d['data']['months'] if m['current']]==['$MB']")" "True/True"
MFIN=$(api GET /api/groups/$MA/financials)
check "the money of a month equals its Financials window" "$(echo "$MF" | jq_ "[(float(m['expected']), float(m['collected'])) for m in d['data']['months'] if m['id']=='$MA'][0]")" "$(echo "$MFIN" | jq_ "(float(d['data']['totals']['expected']), float(d['data']['totals']['collected']))")"
check "sessions and attendance % come from that month's records" "$(echo "$MF" | jq_ "[(m['sessions'], m['attendancePct']) for m in d['data']['months'] if m['id']=='$MA'][0]")" "($(M "SELECT COUNT(DISTINCT d) FROM (SELECT r.attendanceDate d FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId WHERE e.classSectionId='$MA' UNION SELECT DATE(sessionDate) FROM GroupSessionLog WHERE classSectionId='$MA' AND status='HELD') x"), $(M "SELECT COALESCE(ROUND(100*SUM(r.status IN ('PRESENT','LATE'))/COUNT(*)),'None') FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId WHERE e.classSectionId='$MA'"))"
check "who continued and who stopped match the two months' students" "$(echo "$MF" | jq_ "[(m['continued'], len(m['stopped'])) for m in d['data']['months'] if m['id']=='$MA'][0]")" "($(M "SELECT COUNT(*) FROM StudentEnrollment WHERE classSectionId='$MA' AND studentId IN (SELECT studentId FROM StudentEnrollment WHERE classSectionId='$MB')"), $(M "SELECT COUNT(*) FROM StudentEnrollment WHERE classSectionId='$MA' AND COALESCE(withdrawalReason,'')<>'TRANSFERRED' AND studentId NOT IN (SELECT studentId FROM StudentEnrollment WHERE classSectionId='$MB')"))"
MSOLO=$(M "SELECT c.id FROM ClassSection c WHERE c.id NOT IN (SELECT classSectionId FROM GroupCycleLog WHERE newClassSectionId IS NOT NULL) AND c.id NOT IN (SELECT newClassSectionId FROM GroupCycleLog WHERE newClassSectionId IS NOT NULL) LIMIT 1")
check "a group with one month gives just that month" "$(api GET /api/groups/$MSOLO/months | jq_ "len(d['data']['months'])")" "1"
TJ9=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ9" 10.0.8.91
MOWN=$(M "SELECT o.classSectionId FROM SubjectOffering o JOIN Teacher t ON t.id=o.teacherId JOIN User u ON u.id=t.userId WHERE u.email='tch@e2e.local' LIMIT 1")
check "an instructor sees sessions and attendance, never the money" "$(curl -s -b "$TJ9" $B/api/groups/$MOWN/months | jq_ "(d['data']['seeMoney'], any('expected' in m or 'collected' in m for m in d['data']['months']))")" "(False, False)"
MNOT=$(M "SELECT c.id FROM ClassSection c WHERE c.id NOT IN (SELECT o.classSectionId FROM SubjectOffering o JOIN Teacher t ON t.id=o.teacherId JOIN User u ON u.id=t.userId WHERE u.email='tch@e2e.local' AND o.classSectionId IS NOT NULL) AND c.id NOT IN (SELECT s.classSectionId FROM SubstituteAssignment s JOIN Teacher t ON t.id=s.substituteTeacherId JOIN User u ON u.id=t.userId WHERE u.email='tch@e2e.local' AND s.classSectionId IS NOT NULL) LIMIT 1")
check "an instructor cannot open the months of a group that is not his" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ9" $B/api/groups/$MNOT/months)" "403"
rm -f "$TJ9"
echo "== 90. Instructors: no money anywhere, a finished group closes after the set days (2026-11-08)"
TJ0=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ0" 10.0.8.95
tget() { curl -s -b "$TJ0" "$B$1"; }
NG=$(M "SELECT o.classSectionId FROM SubjectOffering o JOIN Teacher t ON t.id=o.teacherId JOIN User u ON u.id=t.userId JOIN ClassSection c ON c.id=o.classSectionId WHERE u.email='tch@e2e.local' AND c.status='ACTIVE' AND EXISTS (SELECT 1 FROM StudentEnrollment e WHERE e.classSectionId=c.id AND e.status='ACTIVE') LIMIT 1")
NS=$(M "SELECT studentId FROM StudentEnrollment WHERE classSectionId='$NG' AND status='ACTIVE' LIMIT 1")
NOFEE="not any(k in str(d) for k in ['dueAmount','paidAmount','totalFeeAmount','feeStatus'])"
check "students list: no money for an instructor" "$(tget "/api/students?limit=50" | jq_ "(d['success'], $NOFEE)")" "(True, True)"
check "one student: no money for an instructor" "$(tget /api/students/$NS | jq_ "(d['success'], $NOFEE)")" "(True, True)"
check "…the office still sees it" "$(api GET /api/students/$NS | jq_ "'dueAmount' in d['data']")/$(api GET '/api/students?limit=5' | jq_ "'dueAmount' in d['data'][0]")" "True/True"
M "UPDATE StudentEnrollment SET withdrawalReason='PAYMENT_OVERDUE_WARNING' WHERE classSectionId='$NG' AND studentId='$NS'"
check "group window: no price and no 'has not paid' flag for an instructor" "$(tget /api/groups/$NG | jq_ "(d['data']['effectivePrice'], d['data']['priceOverride'], d['data']['feeBlocked'], any(e.get('withdrawalReason')=='PAYMENT_OVERDUE_WARNING' for e in d['data']['enrollments']))")" "(None, None, [], False)"
check "…the office still sees the flag" "$(api GET /api/groups/$NG | jq_ "any(e.get('withdrawalReason')=='PAYMENT_OVERDUE_WARNING' for e in d['data']['enrollments'])")" "True"
M "UPDATE StudentEnrollment SET withdrawalReason=NULL WHERE classSectionId='$NG' AND studentId='$NS'"
check "invoices, a student's fees and financials are closed to an instructor" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ0" $B/api/fees)/$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ0" $B/api/students/$NS/fees)/$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ0" $B/api/groups/$NG/financials)" "403/403/403"
DAYS=$(api GET /api/teachers/access/settings | jq_ "d['data']['finishedGroupDays']")
M "UPDATE ClassSection SET status='COMPLETED', completedAt=NOW() - INTERVAL 5 DAY WHERE id='$NG'"
api PUT /api/teachers/access/settings "{\"finishedGroupDays\":$DAYS}" >/dev/null
check "a group finished 5 days ago still opens for its instructor" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ0" $B/api/groups/$NG)/$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ0" $B/api/groups/$NG/months)" "200/200"
M "UPDATE ClassSection SET completedAt=NOW() - INTERVAL 400 DAY WHERE id='$NG'"
api PUT /api/teachers/access/settings "{\"finishedGroupDays\":$DAYS}" >/dev/null
check "after the set days it closes, even with the link" "$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ0" $B/api/groups/$NG)/$(curl -s -o /dev/null -w '%{http_code}' -b "$TJ0" $B/api/groups/$NG/months)" "403/403"
check "…the office still opens it" "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $B/api/groups/$NG)" "200"
M "UPDATE ClassSection SET status='ACTIVE', completedAt=NULL WHERE id='$NG'"
api PUT /api/teachers/access/settings "{\"finishedGroupDays\":$DAYS}" >/dev/null
rm -f "$TJ0"
echo "== 91. Session rating questions, the instructor rates each student, the report for each student (2026-11-09)"
check "default questions; a secretary cannot change them" "$(api GET /api/ratings/settings | jq_ "(len(d['data']['questions']), d['data']['perSession'])")/$(secapi PUT /api/ratings/settings '{"perSession":2}' | jq_ "d['success']")" "(4, 3)/False"
api PUT /api/session-reports/settings '{"enabled":true,"mode":"MANUAL","hours":3,"phrases":[{"id":"focus","en":"Needs more focus","ar":""}]}' >/dev/null
LKE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LK' AND classSectionId='$LG'")
LOE=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LO' AND classSectionId='$LG'")
D2=$(D -2)
sess $LG "$D2" "$(rec $LKE PRESENT),$(rec $LOE PRESENT)" >/dev/null
LKR=$(api POST /api/students/$LK/portal-password '{"target":"student"}'); LK9=$(mktemp); login_jar "$(echo "$LKR" | jq_ "d['data']['loginId']")" "$(echo "$LKR" | jq_ "d['data']['password']")" "$LK9" 10.0.9.11
LPW9=$(api POST /api/students/$LK/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$LGU\"}" | jq_ "d['data']['password']"); LP9=$(mktemp); login_jar 01066660119 "$LPW9" "$LP9" 10.0.9.12
TJ9=$(mktemp); login_jar tch@e2e.local E2eTch12345 "$TJ9" 10.0.9.13
RS=$(curl -s -b "$LK9" $B/api/ratings/student)
Q2=$(echo "$RS" | jq_ "[s['questions'] for s in d['data']['sessions'] if s['date']=='$D2'][0]" | tr -d '\r')
check "the student gets 3 questions for that session" "$(echo "$RS" | jq_ "[len(s['questions']) for s in d['data']['sessions'] if s['date']=='$D2'][0]")" "3"
ANS() { python -c "import sys,json,ast;q=ast.literal_eval(sys.argv[1]);print(json.dumps({x['id']:int(sys.argv[2]) for x in q}))" "$Q2" "$1"; }
rpost() { curl -s -b "$LK9" -X POST -H 'Content-Type: application/json' -d "$1" $B/api/ratings/student; }
check "every question must be answered" "$(rpost "{\"classSectionId\":\"$LG\",\"sessionDate\":\"$D2\",\"answers\":{\"fun\":5}}" | jq_ "d['success']")" "False"
NLOW=$(M "SELECT COUNT(*) FROM Notification WHERE type='LOW_RATING'")
check "all low answers are saved and alert the managers" "$(rpost "{\"classSectionId\":\"$LG\",\"sessionDate\":\"$D2\",\"answers\":$(ANS 2)}" | jq_ "d['success']")/$(M "SELECT rating FROM SessionFeedback WHERE studentId='$LK' AND classSectionId='$LG' AND sessionDate='$D2'")/$(( $(M "SELECT COUNT(*) FROM Notification WHERE type='LOW_RATING'") > NLOW ))" "True/1/1"
check "managers see the average of each question, the instructor without names" "$(api GET /api/ratings/overview | jq_ "any(q['count']>0 for q in d['data']['questions'])")/$(M "SELECT JSON_LENGTH(answers) FROM SessionFeedback WHERE studentId='$LK' AND classSectionId='$LG' AND sessionDate='$D2'")" "True/3"
P9=$(curl -s -b "$TJ9" "$B/api/session-reports?groupId=$LG&date=$D2")
R9=$(echo "$P9" | jq_ "d['data']['report']['id']")
check "the instructor gets the rating items (default 4)" "$(echo "$P9" | jq_ "[c['id'] for c in d['data']['criteria']]")" "['participation', 'understanding', 'behaviour', 'practical']"
check "today: a report with no rating is on the managers' list" "$(api GET /api/today | python -c "import sys,json;d=json.load(sys.stdin);print(any(x['key']=='reportsNotRated' for x in d['data']['tasks']))")" "True"
curl -s -o /dev/null -b "$TJ9" -X PATCH -H 'Content-Type: application/json' -d "{\"homeTip\":\"Try two LEDs\",\"students\":[{\"studentId\":\"$LK\",\"scores\":{\"participation\":5,\"behaviour\":2,\"nope\":3}},{\"studentId\":\"$LO\",\"scores\":{\"participation\":5,\"behaviour\":5}}]}" $B/api/session-reports/$R9
check "each student has his own rating; unknown items are dropped" "$(M "SELECT JSON_LENGTH(scores) FROM SessionReportStudent WHERE reportId='$R9' AND studentId='$LK'")/$(M "SELECT JSON_EXTRACT(scores,'\$.behaviour') FROM SessionReportStudent WHERE reportId='$R9' AND studentId='$LO'")" "2/5"
LOE9=$(M "SELECT id FROM StudentEnrollment WHERE studentId='$LO' AND classSectionId='$LG'")
D3=$(D -3)
sess $LG "$D3" "$(rec $LKE PRESENT),$(rec $LOE9 ABSENT)" >/dev/null
R3=$(curl -s -b "$TJ9" "$B/api/session-reports?groupId=$LG&date=$D3" | jq_ "d['data']['report']['id']")
curl -s -o /dev/null -b "$TJ9" -X PATCH -H 'Content-Type: application/json' -d "{\"students\":[{\"studentId\":\"$LO\",\"scores\":{\"participation\":5}},{\"studentId\":\"$LK\",\"scores\":{\"participation\":4}}]}" $B/api/session-reports/$R3
check "an absent student cannot be rated" "$(M "SELECT COUNT(*) FROM SessionReportStudent WHERE reportId='$R3' AND studentId='$LO' AND scores IS NOT NULL")/$(M "SELECT COUNT(*) FROM SessionReportStudent WHERE reportId='$R3' AND studentId='$LK' AND scores IS NOT NULL")" "0/1"
NSL=$(M "SELECT COUNT(*) FROM Notification WHERE type='SESSION_SCORE_LOW' AND relatedId='$R9'")
curl -s -o /dev/null -b "$TJ9" -X POST $B/api/session-reports/$R9/send
check "sending a report with a low rating tells the managers" "$(( $(M "SELECT COUNT(*) FROM Notification WHERE type='SESSION_SCORE_LOW' AND relatedId='$R9'") > NSL ))" "1"
pv() { curl -s -b "$LP9" "$B/api/session-reports/$R9?student=$LK"; }
check "the instructor's panel shows it unread first" "$(curl -s -b "$TJ9" "$B/api/session-reports?groupId=$LG&date=$D2" | jq_ "[s['read'] for s in d['data']['students'] if s['id']=='$LK'][0]")" "False"
check "the parent sees the tip and the good rating, not the low one" "$(pv | jq_ "(d['data']['homeTip'], [s['id'] for s in d['data']['scores']])")" "('Try two LEDs', ['participation'])"
check "…and it is marked as read" "$(M "SELECT readAt IS NOT NULL FROM SessionReportStudent WHERE reportId='$R9' AND studentId='$LK'")" "1"
check "staff see the low one" "$(api GET "/api/session-reports/$R9?student=$LK" | jq_ "[s['id'] for s in d['data']['scores']]")" "['participation', 'behaviour']"
check "a secretary cannot release it" "$(secapi POST /api/session-reports/$R9/release "{\"studentId\":\"$LK\"}" | jq_ "d['success']")" "False"
check "a manager releases it and the parent sees it" "$(api POST /api/session-reports/$R9/release "{\"studentId\":\"$LK\"}" | jq_ "d['success']")/$(pv | jq_ "len(d['data']['scores'])")" "True/2"
NCT=$(M "SELECT COUNT(*) FROM ContactLog WHERE studentId='$LK'")
check "the student cannot reply, the parent can, once, and it reaches the follow-ups" "$(curl -s -b "$LK9" -X POST -H 'Content-Type: application/json' -d "{\"studentId\":\"$LK\",\"text\":\"hello there\"}" $B/api/session-reports/$R9/reply | jq_ "d['success']")/$(curl -s -b "$LP9" -X POST -H 'Content-Type: application/json' -d "{\"studentId\":\"$LK\",\"text\":\"He did not understand part two\"}" $B/api/session-reports/$R9/reply | jq_ "d['success']")/$(curl -s -b "$LP9" -X POST -H 'Content-Type: application/json' -d "{\"studentId\":\"$LK\",\"text\":\"again\"}" $B/api/session-reports/$R9/reply | jq_ "d['success']")/$(( $(M "SELECT COUNT(*) FROM ContactLog WHERE studentId='$LK'") - NCT ))" "False/True/False/1"
api PUT /api/session-reports/settings '{"enabled":false,"mode":"AUTO","hours":3,"phrases":[{"id":"focus","en":"Needs more focus","ar":""}]}' >/dev/null
rm -f "$LK9" "$LP9" "$TJ9"
echo "== 92. The inventor's journey: islands map details, title, stars, what is left, timeline (2026-11-10)"
JP=$(api GET /api/profile/$LK)
check "the profile carries the journey: title, levels, timeline (joining comes first, even for an old student added later)" "$(echo "$JP" | jq_ "(isinstance(d['data']['journey']['title']['ar'], str), len(d['data']['journey']['levels'])>0, d['data']['journey']['timeline'][0]['kind']=='JOINED')")" "(True, True, True)"
check "every station of the map has its details" "$(echo "$JP" | jq_ "all(any(j['levelId']==l['id'] for j in d['data']['journey']['levels']) for i in d['data']['map']['islands'] for c in i['courses'] for l in c['levels'] if l['state'] in ('DONE','CURRENT'))")" "True"
check "the current level says what is left; a finished one does not" "$(echo "$JP" | jq_ "all((l['left'] is not None)==(l['state']=='CURRENT') for l in d['data']['journey']['levels'])")" "True"
check "stars only on finished levels, 0..3, and the total adds up" "$(echo "$JP" | jq_ "(all(0<=l['stars']<=3 and (l['stars']==0 or l['state']=='DONE') for l in d['data']['journey']['levels']), d['data']['journey']['stars']==sum(l['stars'] for l in d['data']['journey']['levels'] if l['state']=='DONE'))")" "(True, True)"
check "attendance % matches the student's records in that level" "$(echo "$JP" | jq_ "[l['attendancePct'] for l in d['data']['journey']['levels'] if l['levelId']=='$(M "SELECT levelId FROM ClassSection WHERE id='$LG'")'][0]")" "$(M "SELECT ROUND(100*SUM(r.status IN ('PRESENT','LATE'))/COUNT(*)) FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId JOIN ClassSection c ON c.id=e.classSectionId WHERE e.studentId='$LK' AND c.levelId=(SELECT levelId FROM ClassSection WHERE id='$LG')")"
LPW2=$(api POST /api/students/$LK/portal-password "{\"target\":\"guardian\",\"guardianId\":\"$LGU\"}" | jq_ "d['data']['password']"); LP2=$(mktemp); login_jar 01066660119 "$LPW2" "$LP2" 10.0.9.21
JPP=$(curl -s -b "$LP2" $B/api/profile/$LK)
check "the parent sees the same journey, never money" "$(echo "$JPP" | jq_ "(len(d['data']['journey']['levels'])>0, any(k in str(d['data']['journey']) for k in ['amount','price','paid','invoice']))")" "(True, False)"
check "the map look follows the age (young <= 8, older from the setting)" "$(echo "$JP" | jq_ "('YOUNG' if d['data']['age']<=8 else 'OLDER' if d['data']['older'] else 'MIDDLE')==d['data']['look']")" "True"
check "the parent summary points at the last session report sent" "$(echo "$JPP" | jq_ "(d['data']['journey']['lastReport'] or {}).get('id')")" "$(M "SELECT IFNULL((SELECT s.reportId FROM SessionReportStudent s JOIN SessionReport r ON r.id=s.reportId WHERE s.studentId='$LK' AND r.status='SENT' ORDER BY r.sessionDate DESC LIMIT 1),'None')")"
check "another family cannot open it" "$(curl -s -b "$LP2" $B/api/profile/$LO | jq_ "d['success']")" "False"
echo
echo "== 93. Business growth: the company month by month, targets, a branch manager sees his place only (2026-11-10)"
YM=$(cairo +%Y-%m)
BG=$(api GET "/api/business-growth?months=12")
check "the screen loads: 12 months, the running month last, profit shown to the company" "$(echo "$BG" | jq_ "(d['success'], len(d['data']['months']), d['data']['months'][-1]=='$YM', d['data']['companyMoney'], any(h['en']=='Profit' for h in d['data']['headline']))")" "(True, 12, True, True, True)"
INC93=$(M "SELECT (IFNULL((SELECT SUM(amount) FROM FeePayment WHERE status='COMPLETED' AND DATE_FORMAT(CONVERT_TZ(paymentDate,'+00:00','+02:00'),'%Y-%m')='$YM'),0) - IFNULL((SELECT SUM(amount) FROM Refund WHERE status='APPROVED' AND DATE_FORMAT(CONVERT_TZ(approvedAt,'+00:00','+02:00'),'%Y-%m')='$YM'),0))")
check "this month's income = payments − refunds of the month (same rule as the P&L)" "$(echo "$BG" | jq_ "abs(d['data']['monthRows'][-1]['income']-d['data']['monthRows'][-1]['refunds']-float('$INC93'))<0.01")" "True"
check "active students this month = students with a session this month" "$(echo "$BG" | jq_ "d['data']['monthRows'][-1]['active']")" "$(M "SELECT COUNT(DISTINCT e.studentId) FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId WHERE DATE_FORMAT(r.attendanceDate,'%Y-%m')='$YM'")"
check "new students this month = their first session ever is this month" "$(echo "$BG" | jq_ "d['data']['monthRows'][-1]['newStudents']")" "$(M "SELECT COUNT(*) FROM (SELECT e.studentId, MIN(r.attendanceDate) f FROM EnrollmentAttendanceRecord r JOIN StudentEnrollment e ON e.id=r.studentEnrollmentId GROUP BY e.studentId) t WHERE DATE_FORMAT(t.f,'%Y-%m')='$YM'")"
check "the running month has no continuation yet; comparisons cover places, tracks, courses, levels, instructors, partners" "$(echo "$BG" | jq_ "(d['data']['monthRows'][-1]['continuation'], sorted(k for k in d['data']['comparisons'] if k!='month'))")" "(None, ['campus', 'course', 'level', 'partner', 'teacher', 'track'])"
check "where students stop: the bands add up to the students who stopped" "$(echo "$BG" | jq_ "sum(b['count'] for b in d['data']['value']['bands'])==d['data']['value']['stoppedCount']")" "True"
check "an instructor cannot open it" "$(tapi GET /api/business-growth | jq_ "d['success']")" "False"

# targets
check "a % target above 100 is refused" "$(api PUT /api/business-growth/targets "{\"ym\":\"$YM\",\"values\":{\"attendance\":150}}" | jq_ "d['success']")" "False"
check "the manager sets this month's targets" "$(api PUT /api/business-growth/targets "{\"ym\":\"$YM\",\"values\":{\"income\":1000000,\"attendance\":90}}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM BusinessTarget WHERE ym='$YM' AND scopeKey='ALL'")" "True/2"
check "the screen compares them: an income target this big is behind" "$(api GET "/api/business-growth?months=12" | jq_ "[(i['target'], i['state']) for i in d['data']['targets'][0]['items'] if i['metric']=='income'][0]")" "(1000000, 'BEHIND')"
check "an empty value removes a target" "$(api PUT /api/business-growth/targets "{\"ym\":\"$YM\",\"values\":{\"income\":null}}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM BusinessTarget WHERE ym='$YM' AND scopeKey='ALL'")" "True/1"
check "Excel download works" "$(curl -s -o /dev/null -w '%{content_type}' -b "$JAR" "$B/api/business-growth?months=6&format=xlsx")" "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# a branch manager of one place
SECHASH=$(M "SELECT passwordHash FROM User WHERE email='sec@e2e.local'")
M "INSERT INTO User (id, email, passwordHash, role, isActive, updatedAt) VALUES ('e2e-bm-user', 'bm@e2e.local', '$SECHASH', 'BRANCH_MANAGER', 1, NOW(3))"
M "INSERT INTO BranchManager (id, userId, firstName, lastName, campusId, updatedAt) VALUES ('e2e-bm', 'e2e-bm-user', 'Branch', 'Manager', '$CAMPUS', NOW(3))"
BMJ=$(mktemp); login_jar bm@e2e.local E2eSec12345 "$BMJ" 10.0.0.93
BGM=$(curl -s -b "$BMJ" "$B/api/business-growth?months=12")
check "a branch manager sees it without company profit or salaries" "$(echo "$BGM" | jq_ "(d['success'], d['data']['companyMoney'], any(h['en']=='Profit' for h in d['data']['headline']), all(r['profit'] is None and r['salaries']==0 for r in d['data']['monthRows']))")" "(True, False, False, True)"
check "…and only his own place" "$(echo "$BGM" | jq_ "all(c['id']=='$CAMPUS' for c in d['data']['comparisons']['campus'])")" "True"
check "…his income is his place's (group place, else the student's)" "$(echo "$BGM" | jq_ "round(d['data']['monthRows'][-1]['income'])")" "$(M "SELECT ROUND(IFNULL(SUM(p.amount),0)) FROM FeePayment p JOIN FeeInvoice i ON i.id=p.invoiceId LEFT JOIN ClassSection c ON c.id=i.classSectionId JOIN Student s ON s.id=p.studentId WHERE p.status='COMPLETED' AND COALESCE(c.campusId,s.campusId)='$CAMPUS' AND DATE_FORMAT(CONVERT_TZ(p.paymentDate,'+00:00','+02:00'),'%Y-%m')='$YM'")"
check "…and cannot set targets" "$(curl -s -b "$BMJ" -X PUT -H 'Content-Type: application/json' -d "{\"ym\":\"$YM\",\"values\":{\"income\":5}}" $B/api/business-growth/targets | jq_ "d['success']")" "False"
echo
echo "== 94. New website home page preview (x01): admins only, both languages, live numbers (2026-11-11)"
NH=$(curl -s -b "$JAR" -o /tmp/nh94.html -w '%{http_code}' "$B/new-home")
check "an admin opens the preview" "$NH/$(grep -c 'tns-hero' /tmp/nh94.html | tr -d ' ' | sed 's/^[1-9][0-9]*$/yes/')" "200/yes"
check "…and search engines are told not to index it" "$(grep -o 'noindex' /tmp/nh94.html | head -1)" "noindex"
check "on this computer (localhost) a visitor who is not signed in can open it too" "$(curl -s -o /dev/null -w '%{http_code}' "$B/new-home")" "200"
check "…but on a real domain a visitor gets nothing (404)" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: technova.example' "$B/new-home")" "404"
check "the current home page still opens" "$(curl -s -o /dev/null -w '%{http_code}' "$B/")" "200"

echo
echo "== 95. Website screen + website requests (x01 batch 2, 2026-11-11)"
WC=$(api GET /api/website/content)
check "the website screen loads the texts (saved or the originals)" "$(echo "$WC" | jq_ "(d['success'], d['data']['content']['hero']['title2']['ar'])")" "(True, 'وبنبنيها.')"
check "an instructor cannot change the website" "$(tapi PUT /api/website/content '{"content":{}}' | jq_ "d['success']")" "False"
SAVE=$(api PUT /api/website/content '{"content":{"hero":{"title1":{"en":"E2E title","ar":"\u0639\u0646\u0648\u0627\u0646 \u062a\u062c\u0631\u0628\u0629"}},"contact":{"whatsapp":"01011112222"},"why":{"show":false},"hero_extra":"x"}}')
check "the admin saves a new title, a WhatsApp number and hides a section" "$(echo "$SAVE" | jq_ "(d['success'], d['data']['content']['hero']['title1']['ar'], d['data']['content']['contact']['whatsapp'], d['data']['content']['why']['show'], 'hero_extra' in d['data']['content'])")" "(True, 'عنوان تجربة', '01011112222', False, False)"
NH95=$(curl -s "$B/new-home")
check "…the website shows the new title and the WhatsApp button at once" "$(echo "$NH95" | grep -c 'عنوان تجربة' | sed 's/^[1-9][0-9]*$/yes/')/$(echo "$NH95" | grep -c 'wa.me/201011112222' | sed 's/^[1-9][0-9]*$/yes/')" "yes/yes"

# public forms (Arabic goes as JSON \u escapes: curl on Windows breaks Arabic arguments)
R95A=$(curl -s -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.95.1' -d '{"kind":"CONTACT","name":"E2E Visitor","phone":"\u0660\u0661\u0660\u0662\u0662\u0662\u0663\u0663\u0663\u0664\u0664","message":"hello","page":"hero"}' "$B/api/public/website-request")
check "a visitor sends a message from the website (Arabic digits work)" "$(echo "$R95A" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM LandingInquiry WHERE name='E2E Visitor' AND kind='CONTACT' AND phone='01022233344' AND status='NEW'")" "True/1"
check "a school request without the school name is refused" "$(curl -s -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.95.2' -d '{"kind":"SCHOOL","name":"E2E School Mgr","phone":"01033344455"}' "$B/api/public/website-request" | jq_ "d['success']")" "False"
R95S=$(curl -s -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.95.2' -d '{"kind":"SCHOOL","name":"E2E School Mgr","phone":"01033344455","organisation":"E2E Nile School","message":"We want robotics"}' "$B/api/public/website-request")
check "…with the school name it is saved" "$(echo "$R95S" | jq_ "d['success']")" "True"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.95.3' -d '{"kind":"CONTACT","name":"Bot","phone":"01099999999","website":"spam.example"}' "$B/api/public/website-request"
check "a bot that fills the hidden field is kept out" "$(M "SELECT COUNT(*) FROM LandingInquiry WHERE name='Bot'")" "0"
check "the admins are told (in Arabic too)" "$(M "SELECT COUNT(*) FROM Notification n JOIN User u ON u.id=n.userId WHERE u.role='SUPER_ADMIN' AND n.titleAr LIKE 'طلب جديد من الموقع%'")" "$(M "SELECT 2*COUNT(*) FROM User WHERE role='SUPER_ADMIN' AND isActive=1")"
L95=$(api GET "/api/landing/inquiries?kind=SCHOOL")
check "website requests: the school request shows with its school" "$(echo "$L95" | jq_ "[(i['organisation'], i['kind']) for i in d['data'] if i['name']=='E2E School Mgr'][0]")" "('E2E Nile School', 'SCHOOL')"
SID95=$(M "SELECT id FROM LandingInquiry WHERE name='E2E School Mgr' LIMIT 1")
P95=$(api POST "/api/landing/inquiries/$SID95/partner")
check "'make a partner' creates a possible partner (stopped until a deal)" "$(echo "$P95" | jq_ "d['success']")/$(M "SELECT CONCAT(kind,'/',isActive,'/',contactPhone) FROM Partner WHERE name='E2E Nile School'")/$(M "SELECT status FROM LandingInquiry WHERE id='$SID95'")" "True/SCHOOL/0/01033344455/RESOLVED"
check "…a second click links to the same partner, never a copy" "$(api POST "/api/landing/inquiries/$SID95/partner" | jq_ "d['data']['existing']")/$(M "SELECT COUNT(*) FROM Partner WHERE name='E2E Nile School'")" "True/1"
check "an instructor cannot read website requests" "$(tapi GET /api/landing/inquiries | jq_ "d['success']")" "False"
check "back to the original texts" "$(api PUT /api/website/content '{"reset":true}' | jq_ "d['data']['content']['hero']['title1']['ar']")/$(M "SELECT COUNT(*) FROM AppSetting WHERE \`key\`='website.content'")" "بنعلّم التكنولوجيا…/0"

echo
echo "== 96. Website visitors: where they come from, time, events, IP only with consent (x01 batch 3, 2026-11-11)"
UA96='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
trk() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "User-Agent: $UA96" -H "X-Forwarded-For: $1" -d "$2" "$B/api/public/site-track"; }
check "a visit from Google (no cookies) starts" "$(trk 10.0.96.1 '{"t":"start","sid":"e2evisit96aaaa01","consent":false,"path":"/new-home","ref":"https://www.google.com.eg/search?q=robotics","lang":"ar"}')/$(M "SELECT CONCAT(source,'/',device,'/',IFNULL(ip,'no-ip')) FROM SiteVisit WHERE sessionId='e2evisit96aaaa01'")" "204/GOOGLE/MOBILE/no-ip"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"t":"start","sid":"e2evisit96bot001","path":"/new-home"}' "$B/api/public/site-track"
check "a bot / script is not counted" "$(M "SELECT COUNT(*) FROM SiteVisit WHERE sessionId='e2evisit96bot001'")" "0"
trk 10.0.96.1 '{"t":"ping","sid":"e2evisit96aaaa01"}' >/dev/null; trk 10.0.96.1 '{"t":"ping","sid":"e2evisit96aaaa01"}' >/dev/null
trk 10.0.96.1 '{"t":"event","sid":"e2evisit96aaaa01","kind":"AUDIENCE","label":"For my school"}' >/dev/null
trk 10.0.96.1 '{"t":"event","sid":"e2evisit96aaaa01","kind":"FORM_SENT","label":"SCHOOL:education"}' >/dev/null
check "time on site grows by the pings; sending a form marks the visit" "$(M "SELECT CONCAT(seconds,'/',converted) FROM SiteVisit WHERE sessionId='e2evisit96aaaa01'")" "30/1"
check "a campaign link with cookies accepted keeps the IP" "$(trk 10.0.96.2 '{"t":"start","sid":"e2evisit96bbbb02","vid":"e2evisitor96xx01","consent":true,"path":"/new-home?utm_source=facebook&utm_campaign=winter-camp","utm":{"source":"facebook","campaign":"winter-camp"}}')/$(M "SELECT CONCAT(source,'/',utmCampaign,'/',ip,'/',visitorId) FROM SiteVisit WHERE sessionId='e2evisit96bbbb02'")" "204/FACEBOOK/winter-camp/10.0.96.2/e2evisitor96xx01"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.96.3' -d '{"kind":"CONTACT","name":"E2E Tracked","phone":"01044455566","sid":"e2evisit96aaaa01"}' "$B/api/public/website-request"
V96=$(api GET "/api/website/visitors?days=7")
check "the visitors screen: visits, sources, campaign, cards, forms, requests by source" "$(echo "$V96" | jq_ "(d['success'], d['data']['totals']['visits'] >= 2, [s['count'] for s in d['data']['bySource'] if s['key']=='GOOGLE'][0] >= 1, [c['key'] for c in d['data']['byCampaign']][0], [a['count'] for a in d['data']['audience'] if a['key']=='For my school'][0], [s['requests'] for s in d['data']['bySource'] if s['key']=='GOOGLE'][0] >= 1)")" "(True, True, True, 'winter-camp', 1, True)"
check "…and never shows an IP" "$(echo "$V96" | grep -c '10.0.96.2')" "0"
check "an instructor cannot open it" "$(tapi GET /api/website/visitors | jq_ "d['success']")" "False"
M "UPDATE SiteVisit SET startedAt = NOW(3) - INTERVAL 100 DAY WHERE sessionId='e2evisit96bbbb02'"
curl -s -H 'Authorization: Bearer e2e-cron' $B/api/cron/daily >/dev/null
check "the daily job wipes IPs older than 90 days (the visit stays)" "$(M "SELECT CONCAT(COUNT(*),'/',IFNULL(MAX(ip),'wiped')) FROM SiteVisit WHERE sessionId='e2evisit96bbbb02'")" "1/wiped"

echo
echo "== 97. Website items: products, achievements, media from the system (x01 batch 5, 2026-11-12)"
NH97=$(curl -s "$B/new-home")
check "before any item: the example cards show in the preview" "$(echo "$NH97" | grep -c 'tns-sample' | sed 's/^[1-9][0-9]*$/yes/')" "yes"
I97A=$(api POST /api/website/items '{"kind":"PRODUCT","category":"EDUCATIONAL","titleEn":"E2E Robot Kit","titleAr":"","metaEn":"Ages 8+","price":1500,"showPrice":true,"imageUrl":"https://example.com/kit.jpg"}')
check "the admin adds a product (an empty Arabic title borrows the English one)" "$(echo "$I97A" | jq_ "(d['success'], d['data']['titleAr'])")" "(True, 'E2E Robot Kit')"
api POST /api/website/items '{"kind":"PRODUCT","category":"DEVICE","titleEn":"E2E Hidden Device","titleAr":"E2E Hidden Device","show":false}' >/dev/null
api POST /api/website/items '{"kind":"ACHIEVEMENT","category":"COMPETITION","titleEn":"E2E WRO Team","titleAr":"E2E WRO Team","metaEn":"2nd place","featured":true}' >/dev/null
api POST /api/website/items '{"kind":"MEDIA","category":"VIDEO","titleEn":"E2E Episode","titleAr":"E2E Episode","videoUrl":"https://youtu.be/abcDEF12345"}' >/dev/null
check "a wrong category or a script link is refused" "$(api POST /api/website/items '{"kind":"PRODUCT","category":"VIDEO","titleEn":"x","titleAr":"x"}' | jq_ "d['success']")/$(api POST /api/website/items '{"kind":"MEDIA","category":"NEWS","titleEn":"x","titleAr":"x","linkUrl":"javascript:alert(1)"}' | jq_ "d['success']")" "False/False"
check "an instructor cannot add items" "$(tapi POST /api/website/items '{"kind":"PRODUCT","category":"OTHER","titleEn":"x","titleAr":"x"}' | jq_ "d['success']")" "False"
NH97B=$(curl -s "$B/new-home")
check "the website shows the real product, achievement and video, with the price" "$(echo "$NH97B" | grep -c 'E2E Robot Kit' | sed 's/^[1-9][0-9]*$/yes/')/$(echo "$NH97B" | grep -c 'E2E WRO Team' | sed 's/^[1-9][0-9]*$/yes/')/$(echo "$NH97B" | grep -c 'img.youtube.com/vi/abcDEF12345' | sed 's/^[1-9][0-9]*$/yes/')/$(echo "$NH97B" | grep -c '1,500' | sed 's/^[1-9][0-9]*$/yes/')" "yes/yes/yes/yes"
check "…a hidden item stays off the website, and the example products / achievements / videos are gone (events keep theirs)" "$(echo "$NH97B" | grep -c 'E2E Hidden Device')/$(echo "$NH97B" | grep -o 'tns-sample' | wc -l | tr -d ' ')" "0/2"
IDA=$(echo "$I97A" | jq_ "d['data']['id']")
check "hiding the product takes it off the website" "$(api PATCH "/api/website/items/$IDA" '{"kind":"PRODUCT","category":"EDUCATIONAL","titleEn":"E2E Robot Kit","titleAr":"E2E Robot Kit","show":false}' | jq_ "d['data']['show']")/$(curl -s "$B/new-home" | grep -c 'E2E Robot Kit')" "False/0"
check "deleting an item removes it" "$(api DELETE "/api/website/items/$IDA" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM SiteItem WHERE id='$IDA'")" "True/0"

echo
echo "== 98. Website pages: education, solutions (+ each), products, achievements (+ each), media, partners, about, certificate check (x01 batch 6, 2026-11-12)"
P98=""
for p in education solutions products achievements media partners about verify; do P98="$P98$(curl -s -o /dev/null -w '%{http_code}' "$B/$p") "; done
check "every website page opens (on this computer)" "$P98" "200 200 200 200 200 200 200 200 "
check "…but on a real domain they are still locked (404) while the site is a preview" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: technova.example' "$B/about")/$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: technova.example' "$B/solutions/smart-hotels-and-resorts")" "404/404"
check "a certificate check link stays open everywhere" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: technova.example' "$B/verify/TN-CERT-2026-00001")" "200"
check "each solution has its own page; an unknown one shows 'not found' (kept out of Google)" "$(curl -s -o /dev/null -w '%{http_code}' "$B/solutions/smart-hotels-and-resorts")/$(curl -s "$B/solutions/no-such-thing" | grep -o 'NEXT_HTTP_ERROR_FALLBACK;404' | head -1)" "200/NEXT_HTTP_ERROR_FALLBACK;404"
HM98=$(curl -s "$B/new-home")
check "the menu and the home page link to the pages" "$(echo "$HM98" | grep -o 'href="/education"' | head -1)/$(echo "$HM98" | grep -o 'href="/solutions/smart-hotels-and-resorts"' | head -1)" 'href="/education"/href="/solutions/smart-hotels-and-resorts"'
I98=$(api POST /api/website/items '{"kind":"ACHIEVEMENT","category":"PROJECT","titleEn":"E2E Reef Guard","titleAr":"E2E Reef Guard","textEn":"A sensor that watches the reef","videoUrl":"https://youtu.be/abcDEF12345"}' | jq_ "d['data']['id']")
AP98=$(curl -s "$B/achievements/$I98")
check "an achievement has its own page with its video" "$(echo "$AP98" | grep -c 'E2E Reef Guard' | sed 's/^[1-9][0-9]*$/yes/')/$(echo "$AP98" | grep -o 'youtube-nocookie.com/embed/abcDEF12345' | head -1)" "yes/youtube-nocookie.com/embed/abcDEF12345"
check "…the achievements page links to it; an unknown one shows 'not found'" "$(curl -s "$B/achievements" | grep -o "href=\"/achievements/$I98\"" | head -1)/$(curl -s "$B/achievements/nope" | grep -o 'NEXT_HTTP_ERROR_FALLBACK;404' | head -1)" "href=\"/achievements/$I98\"/NEXT_HTTP_ERROR_FALLBACK;404"
api DELETE "/api/website/items/$I98" >/dev/null

echo
echo "== 99. Campaign pages, Google, certificate result page, cost per new student by ad (x01 batch 7, 2026-11-12)"
TODAY99=$(cairo +%Y-%m-%d)
C99=$(api POST /api/website/campaigns "{\"slug\":\"e2e-winter-camp\",\"titleEn\":\"E2E Winter Camp\",\"titleAr\":\"\",\"offerEn\":\"1,200 EGP\",\"formKind\":\"CONTACT\",\"startsAt\":\"$TODAY99\",\"banner\":true,\"bannerEn\":\"E2E camp banner\",\"bannerAr\":\"E2E camp banner\"}")
check "the admin makes a campaign page with a banner" "$(echo "$C99" | jq_ "d['success']")" "True"
check "the same link name twice is refused; a bad link name too" "$(api POST /api/website/campaigns '{"slug":"e2e-winter-camp","titleEn":"x","titleAr":"x"}' | jq_ "d['success']")/$(api POST /api/website/campaigns '{"slug":"Bad Name!","titleEn":"x","titleAr":"x"}' | jq_ "d['success']")" "False/False"
CP99=$(curl -s "$B/c/e2e-winter-camp")
check "the campaign page opens with its offer" "$(echo "$CP99" | grep -o 'E2E Winter Camp' | head -1)/$(echo "$CP99" | grep -o '1,200 EGP' | head -1)" "E2E Winter Camp/1,200 EGP"
check "…and its banner shows on top of the website pages" "$(curl -s "$B/new-home" | grep -o 'href="/c/e2e-winter-camp"' | head -1)" 'href="/c/e2e-winter-camp"'
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.99.1' -d '{"kind":"CONTACT","name":"E2E Camp Parent","phone":"01055500099","page":"campaign:e2e-winter-camp"}' "$B/api/public/website-request"
check "the campaigns list counts its requests" "$(api GET /api/website/campaigns | jq_ "[(c['state'], c['requests']) for c in d['data'] if c['slug']=='e2e-winter-camp'][0]")" "('LIVE', 1)"
CID99=$(api GET /api/website/campaigns | jq_ "[c['id'] for c in d['data'] if c['slug']=='e2e-winter-camp'][0]")
api PATCH "/api/website/campaigns/$CID99" '{"slug":"e2e-winter-camp","titleEn":"E2E Winter Camp","titleAr":"E2E Winter Camp","startsAt":"2020-01-01","endsAt":"2020-01-10","banner":true}' >/dev/null
check "an ended campaign sends its old link to the home page and its banner goes away" "$(curl -s -i "$B/c/e2e-winter-camp" | grep -o '/new-home' | head -1)/$(curl -s "$B/new-home" | grep -c 'href="/c/e2e-winter-camp"')" "/new-home/0"
check "an instructor cannot make campaigns" "$(tapi POST /api/website/campaigns '{"slug":"e2e-x","titleEn":"x","titleAr":"x"}' | jq_ "d['success']")" "False"

# Google
check "robots.txt keeps the system out and points to the sitemap" "$(curl -s "$B/robots.txt" | grep -c 'Disallow: /dashboard')/$(curl -s "$B/robots.txt" | grep -o 'sitemap.xml' | head -1)" "1/sitemap.xml"
check "sitemap.xml is built from the site (no old template domain)" "$(curl -s -o /dev/null -w '%{http_code}' "$B/sitemap.xml")/$(curl -s "$B/sitemap.xml" | grep -c 'evershineacadmey')" "200/0"
check "a page has its title, description and share card" "$(curl -s "$B/solutions/smart-hotels-and-resorts" | grep -o 'property="og:title"' | head -1)/$(curl -s "$B/education" | grep -o 'name="description"' | head -1)" 'property="og:title"/name="description"'

# certificate result page
CN99=$(M "SELECT certificateNumber FROM Certificate WHERE status='VALID' LIMIT 1")
if [ -n "$CN99" ]; then
  check "a certificate result page shows the student in the new look (this computer)" "$(curl -s "$B/verify/$CN99" | grep -o 'tns-cert ok' | head -1)" "tns-cert ok"
fi
check "an unknown number says so" "$(curl -s "$B/verify/TN-CERT-1999-99999" | grep -o 'tns-cert bad' | head -1)" "tns-cert bad"
check "on a real domain the old result page stays until the switch" "$(curl -s -H 'Host: technova.example' "$B/verify/TN-CERT-1999-99999" | grep -c 'tns-cert')" "0"

# cost per new student by ad source
YM99=$(cairo +%Y-%m)
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0) Chrome/130' -H 'X-Forwarded-For: 10.0.99.2' -d '{"t":"start","sid":"e2eads99aaaaaa01","consent":false,"path":"/new-home?utm_source=facebook","utm":{"source":"facebook"}}' "$B/api/public/site-track"
curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -H 'X-Forwarded-For: 10.0.99.3' -d '{"kind":"CONTACT","name":"E2E Ad Parent","phone":"01055500098","sid":"e2eads99aaaaaa01"}' "$B/api/public/website-request"
A99=$(api PUT /api/business-growth/ad-sources "{\"ym\":\"$YM99\",\"values\":{\"FACEBOOK\":1000}}")
check "the manager types the Facebook spend; cost per request is worked out" "$(echo "$A99" | jq_ "[(r['spend'], r['requests'] >= 1, r['costPerRequest'] is not None) for r in d['data']['rows'] if r['source']=='FACEBOOK'][0]")" "(1000, True, True)"
check "a branch manager cannot see ad money" "$(curl -s -b "$BMJ" "$B/api/business-growth/ad-sources?ym=$YM99" | jq_ "d['success']")" "False"

echo
echo "== 100. Courses page: tracks / courses listed on the website, page sections with settings (six phases 1-a, 2026-11-13)"
TR100=$(M "SELECT t.id FROM Track t JOIN AcademicSubject s ON s.trackId=t.id JOIN Level l ON l.subjectId=s.id WHERE t.isActive=1 AND s.isActive=1 AND l.isActive=1 LIMIT 1")
CO100=$(M "SELECT s.id FROM AcademicSubject s JOIN Level l ON l.subjectId=s.id WHERE s.trackId='$TR100' AND s.isActive=1 AND l.isActive=1 LIMIT 1")
check "the admin sees tracks and courses to list" "$(api GET /api/website/courses | jq_ "(d['success'], any(i['refType']=='TRACK' for i in d['data']['items']), any(i['refType']=='COURSE' for i in d['data']['items']))")" "(True, True, True)"
check "a track is listed with its own page and sections" "$(api PUT /api/website/courses "{\"listing\":{\"refType\":\"TRACK\",\"refId\":\"$TR100\",\"slug\":\"e2e-track\",\"show\":true,\"titleEn\":\"E2E Robot Path\",\"titleAr\":\"E2E Robot Path\",\"summaryEn\":\"From blocks to robots\",\"sections\":{\"outcomes\":{\"show\":true,\"items\":[{\"en\":\"Build a line follower\",\"ar\":\"Build a line follower\"}]},\"faq\":{\"items\":[{\"q\":{\"en\":\"E2E question?\",\"ar\":\"E2E question?\"},\"a\":{\"en\":\"Yes\",\"ar\":\"Yes\"}}]}}}}" | jq_ "d['success']")" "True"
check "the same link name for another course is refused" "$(api PUT /api/website/courses "{\"listing\":{\"refType\":\"COURSE\",\"refId\":\"$CO100\",\"slug\":\"e2e-track\",\"show\":true}}" | jq_ "d['success']")" "False"
api PUT /api/website/courses "{\"listing\":{\"refType\":\"COURSE\",\"refId\":\"$CO100\",\"slug\":\"e2e-course\",\"show\":true,\"titleEn\":\"E2E Inner Course\",\"titleAr\":\"E2E Inner Course\"}}" >/dev/null
CL100=$(curl -s "$B/courses")
check "the courses page shows the track; a course inside a track stays hidden until 'sold alone'" "$(echo "$CL100" | grep -o 'href="/courses/e2e-track"' | head -1)/$(echo "$CL100" | grep -c 'href="/courses/e2e-course"')" 'href="/courses/e2e-track"/0'
api PUT /api/website/courses "{\"listing\":{\"refType\":\"COURSE\",\"refId\":\"$CO100\",\"slug\":\"e2e-course\",\"show\":true,\"soldAlone\":true,\"titleEn\":\"E2E Inner Course\",\"titleAr\":\"E2E Inner Course\"}}" >/dev/null
check "…and shows once it may be sold alone" "$(curl -s "$B/courses" | grep -o 'href="/courses/e2e-course"' | head -1)" 'href="/courses/e2e-course"'
CP100=$(curl -s "$B/courses/e2e-track")
check "the course page shows its outcomes and questions" "$(echo "$CP100" | grep -o 'Build a line follower' | head -1)/$(echo "$CP100" | grep -o 'E2E question?' | head -1)" "Build a line follower/E2E question?"
api PUT /api/website/courses '{"settings":{"sections":{"faq":false}}}' >/dev/null
check "switching a section off for the company hides it (the course follows the default)" "$(curl -s "$B/courses/e2e-track" | grep -o 'class="tns-faq"' | wc -l | tr -d ' ')" "0"
api PUT /api/website/courses '{"settings":{"sections":{"faq":true}}}' >/dev/null
check "an unknown course shows 'not found'; an instructor cannot change listings" "$(curl -s "$B/courses/nope" | grep -o 'NEXT_HTTP_ERROR_FALLBACK;404' | head -1)/$(tapi PUT /api/website/courses '{"settings":{"sections":{"faq":false}}}' | jq_ "d['success']")" "NEXT_HTTP_ERROR_FALLBACK;404/False"

echo "== 101. Website sign-up steps + enrolment codes (six phases 1-a batch 2, 2026-11-13)"
LV101=$(M "SELECT id FROM Level WHERE subjectId='$CO100' AND isActive=1 ORDER BY \`order\` ASC LIMIT 1")
M "UPDATE Level SET allowedModes=NULL WHERE id='$LV101'"; M "UPDATE AcademicSubject SET allowedModes=NULL WHERE id='$CO100'"; M "UPDATE Track SET allowedModes=NULL WHERE id='$TR100'"
api POST /api/groups "{\"campusId\":\"$ONP\",\"className\":\"E2E Join\",\"sectionName\":\"J\",\"levelId\":\"$LV101\",\"scheduleSlots\":[{\"dayOfWeek\":6,\"time\":\"17:00\"}]}" >/dev/null
JG=$(M "SELECT id FROM ClassSection WHERE className='E2E Join' AND campusId='$ONP' LIMIT 1")
check "an online group of the first level exists for the course" "$([ -n "$JG" ] && echo yes)" "yes"
check "the website sign-up steps page still opens (the course button now books inside the account: section 103)" "$(curl -s "$B/join/e2e-course" | grep -o 'class="tns-join"' | head -1)" 'class="tns-join"'
check "an unknown course has no sign-up page" "$(curl -s "$B/join/nope" | grep -o 'NEXT_HTTP_ERROR_FALLBACK;404' | head -1)" "NEXT_HTTP_ERROR_FALLBACK;404"
CB=$(api POST /api/enrolment-codes '{"batch":"E2EJOIN","count":2,"kind":"PERCENT","value":20,"maxUses":1}')
JC1=$(echo "$CB" | jq_ "d['data']['codes'][0]"); JC2=$(echo "$CB" | jq_ "d['data']['codes'][1]")
check "staff make a batch of 2 codes (one discount type for the batch)" "$(echo "$CB" | jq_ "len(d['data']['codes'])")/$(M "SELECT COUNT(DISTINCT discountTypeId) FROM EnrolmentCode WHERE batch='E2EJOIN'")" "2/1"
check "the same batch name again is refused; an instructor cannot make codes" "$(api POST /api/enrolment-codes '{"batch":"E2EJOIN","count":1,"kind":"FREE"}' | jq_ "d['success']")/$(tapi POST /api/enrolment-codes '{"batch":"E2EX","count":1,"kind":"FREE"}' | jq_ "d['success']")" "False/False"
PC() { curl -s -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: $2" -d "$1" $B/api/public/codes; }
check "the website checks a code: good → 20% off; unknown → not found" "$(PC "{\"code\":\"$JC1\",\"listing\":\"e2e-course\"}" 10.9.1.1 | jq_ "(d['data']['ok'], d['data']['text']['en'])")/$(PC '{"code":"NOPE-XXXX","listing":"e2e-course"}' 10.9.1.1 | jq_ "d['data']['problem']")" "(True, '20% off')/NOT_FOUND"
SU() { curl -s -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: $2" -d "$1" $B/api/public/signup; }
STU='{"firstName":"Joinkid","lastName":"Webtest","dob":"2016-05-01","gender":"MALE"}'
STU2='{"firstName":"Joinsis","lastName":"Webtest","dob":"2018-02-01","gender":"FEMALE"}'
PAR='"who":"PARENT","parent":{"firstName":"Webmom","lastName":"Webtest","phone":"01099988877"},"country":"Egypt","city":"Hurghada","agree":true'
check "a 1-use code is not enough for two children" "$(SU "{\"listing\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",$PAR,\"students\":[$STU,$STU2],\"code\":\"$JC1\"}" 10.9.2.1 | jq_ "d['success']")" "False"
check "signing up alone under 18 is refused" "$(SU "{\"listing\":\"e2e-course\",\"mode\":\"ONLINE\",\"who\":\"SELF\",\"selfPhone\":\"01099988866\",\"city\":\"Cairo\",\"agree\":true,\"students\":[$STU]}" 10.9.2.2 | jq_ "d['success']")" "False"
SR=$(SU "{\"listing\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",$PAR,\"students\":[$STU],\"code\":\"$JC1\",\"paymentRef\":\"IP-7788\"}" 10.9.2.3)
check "a parent signs up one child with the code → one admission request" "$(echo "$SR" | jq_ "(d['success'], d['data']['count'])")" "(True, 1)"
JAR101=$(M "SELECT id FROM AdmissionRequest WHERE firstName='Joinkid' AND lastName='Webtest' ORDER BY createdAt DESC LIMIT 1")
check "the request carries the course page, the way, the group, the code and the transfer number" "$(M "SELECT CONCAT(sourceOfInfo,'/',signupListing,'/',signupMode,'/',preferredClassSectionId='$JG','/',signupCode='$JC1','/',paymentRef,'/',status) FROM AdmissionRequest WHERE id='$JAR101'")" "WEBSITE/e2e-course/ONLINE/1/1/IP-7788/PENDING"
check "the code is used once and cannot be used again" "$(M "SELECT uses FROM EnrolmentCode WHERE code='$JC1'")/$(PC "{\"code\":\"$JC1\",\"listing\":\"e2e-course\"}" 10.9.1.1 | jq_ "d['data']['problem']")" "1/USED_UP"
check "staff are told about the website sign-up" "$(M "SELECT COUNT(*)>0 FROM Notification WHERE relatedId='$JAR101'")" "1"
check "the codes list shows who used it" "$(api GET /api/enrolment-codes/E2EJOIN | jq_ "[c['usedBy'][0]['phone'] for c in d['data'] if c['code']=='$JC1']")" "['01099988877']"
check "the codes download as Excel" "$(curl -s -o /dev/null -w '%{content_type}' -b "$JAR" "$B/api/enrolment-codes/E2EJOIN?format=xlsx" | grep -c spreadsheetml)" "1"
check "approving the request → the student is in the chosen group and the code is an approved discount" "$(api POST /api/admissions/$JAR101/approve "{\"campusId\":\"$ONP\",\"classSectionId\":\"$JG\",\"confirmNotDuplicate\":true}" | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM DiscountAssignment da JOIN EnrolmentCode ec ON ec.discountTypeId=da.discountTypeId WHERE ec.code='$JC1' AND da.status='ACTIVE' AND da.approvedAt IS NOT NULL")" "True/1"
JS101=$(M "SELECT studentId FROM DiscountAssignment da JOIN EnrolmentCode ec ON ec.discountTypeId=da.discountTypeId WHERE ec.code='$JC1' LIMIT 1")
check "the student is enrolled in the online group" "$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE studentId='$JS101' AND classSectionId='$JG'")" "1"
api PATCH /api/enrolment-codes/E2EJOIN '{"active":false}' >/dev/null
check "a stopped batch: its codes are refused on the website" "$(PC "{\"code\":\"$JC2\",\"listing\":\"e2e-course\"}" 10.9.1.1 | jq_ "d['data']['problem']")" "OFF"
echo "== 102. Family accounts: sign up first, children, suitable courses, staff accounts + password link (six phases 1-A, 2026-11-13)"
PA() { curl -s -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: $2" -d "$1" $B/api/public/account; }
FA='"firstName":"Famdad","lastName":"Accounttest","password":"famPass2026","city":"Hurghada","agree":true'
check "a parent makes an account on the website (ready at once)" "$(PA "{\"who\":\"PARENT\",$FA,\"phone\":\"01033344455\"}" 10.8.1.1 | jq_ "(d['success'], d['data']['phone'])")/$(M "SELECT CONCAT(g.signupSource,'/',u.role,'/',u.email) FROM Guardian g JOIN User u ON u.id=g.userId WHERE g.phoneNumber='01033344455'")" "(True, '01033344455')/WEBSITE/GUARDIAN/guardian_01033344455@technova.local"
check "the same number again (also written +20…) → 'you have an account'" "$(PA "{\"who\":\"PARENT\",$FA,\"phone\":\"01033344455\"}" 10.8.1.2 | jq_ "d['error']['code']")/$(PA "{\"who\":\"PARENT\",$FA,\"phone\":\"+201033344455\"}" 10.8.1.3 | jq_ "d['error']['code']")" "ACCOUNT_EXISTS/ACCOUNT_EXISTS"
check "the phone as the password is refused" "$(PA "{\"who\":\"PARENT\",\"firstName\":\"Pw\",\"lastName\":\"Test\",\"password\":\"01033344466\",\"city\":\"Cairo\",\"agree\":true,\"phone\":\"01033344466\"}" 10.8.1.4 | jq_ "d['success']")" "False"
check "a student alone under 18 is refused; 18+ is made with himself in the family" "$(PA "{\"who\":\"SELF\",$FA,\"phone\":\"01033344477\",\"dob\":\"$(( $(cairo +%Y) - 15 ))-01-01\",\"gender\":\"MALE\"}" 10.8.1.5 | jq_ "d['error']['code']")/$(PA "{\"who\":\"SELF\",$FA,\"phone\":\"01033344488\",\"dob\":\"2000-02-02\",\"gender\":\"FEMALE\"}" 10.8.1.6 | jq_ "d['success']")/$(M "SELECT CONCAT(g.selfAccount,'/',COUNT(m.id),'/',MAX(m.isSelf)) FROM Guardian g JOIN FamilyMember m ON m.guardianId=g.id WHERE g.phoneNumber='01033344488' GROUP BY g.id")" "TOO_YOUNG/True/1/1/1"
FJ=$(mktemp); login_jar 01033344455 famPass2026 "$FJ" 10.8.2.1
fapi() { curl -s -b "$FJ" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
check "the family signs in with its phone and sees its (empty) family" "$(fapi GET /api/guardian-portal/family | jq_ "(d['success'], len(d['data']['people']), d['data']['settings']['unsuitable'])")" "(True, 0, 'LOCK')"
M "UPDATE Track SET minAge=8, maxAge=12 WHERE id='$TR100'"
Y6=$(( $(cairo +%Y) - 6 ))
FM1=$(fapi POST /api/guardian-portal/family/members "{\"firstName\":\"Littleone\",\"lastName\":\"Accounttest\",\"dob\":\"$Y6-01-15\",\"gender\":\"MALE\"}" | jq_ "d['data']['id']")
check "the family adds a child of 6" "$(M "SELECT COUNT(*) FROM FamilyMember WHERE id='$FM1'")/$(fapi GET /api/guardian-portal/family | jq_ "[p['age'] for p in d['data']['people']]")" "1/[6]"
FC() { fapi GET "/api/guardian-portal/family/courses?person=m:$1" | jq_ "[(c['fit'], c['bookable']) for c in d['data']['courses'] if c['slug']=='e2e-track']"; }
check "a track for 8–12 is locked for a 6-year-old (shown with a lock)" "$(FC $FM1)" "[('TOO_YOUNG', False)]"
check "another family cannot see this child's courses" "$(curl -s -b "$JAR" "$B/api/guardian-portal/family/courses?person=m:$FM1" | jq_ "d['success']")" "False"
FG102=$(M "SELECT id FROM Guardian WHERE phoneNumber='01033344455'")
check "an instructor cannot open family accounts" "$(tapi GET /api/family-accounts | jq_ "d['success']")" "False"
check "staff see the new account (from the website, no student yet)" "$(api GET '/api/family-accounts?filter=NO_BOOKING&q=Accounttest' | jq_ "[(r['signupSource'], r['members'], r['students']) for r in d['data'] if r['id']=='$FG102']")" "[('WEBSITE', 1, 0)]"
check "staff open the track for this child → open for him" "$(api POST /api/family-accounts/$FG102/unlocks "{\"refType\":\"TRACK\",\"refId\":\"$TR100\",\"person\":\"m:$FM1\",\"note\":\"strong kid\"}" | jq_ "d['success']")/$(FC $FM1)" "True/[('OPENED', True)]"
FM2=$(fapi POST /api/guardian-portal/family/members "{\"firstName\":\"Tinyone\",\"lastName\":\"Accounttest\",\"dob\":\"$Y6-03-01\",\"gender\":\"FEMALE\"}" | jq_ "d['data']['id']")
api PUT /api/family-accounts/settings '{"unsuitable":"HIDE"}' >/dev/null
check "setting 'hide': the sister does not see the locked track; the opened one still shows for her brother" "$(FC $FM2)/$(FC $FM1)" "[]/[('OPENED', True)]"
api PUT /api/family-accounts/settings '{"unsuitable":"LOCK"}' >/dev/null
check "a secretary cannot change the settings" "$(secapi PUT /api/family-accounts/settings '{"unsuitable":"HIDE"}' | jq_ "d['success']")" "False"
check "the family removes a child not registered yet" "$(fapi DELETE /api/guardian-portal/family/members/$FM2 | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM FamilyMember WHERE id='$FM2'")" "True/0"
check "'your work today' lists new families with no student" "$(api GET /api/today | jq_ "any(t['key']=='familiesNoChild' for t in d['data']['tasks'])")" "True"
SA102=$(secapi POST /api/family-accounts "{\"firstName\":\"Branchmom\",\"lastName\":\"Offlinetest\",\"phone\":\"01033344499\",\"city\":\"Hurghada\",\"members\":[{\"firstName\":\"Branchkid\",\"lastName\":\"Offlinetest\",\"dob\":\"2016-05-05\",\"gender\":\"MALE\"}]}")
TOK102=$(echo "$SA102" | jq_ "d['data']['link'].split('/')[-1]")
check "a secretary makes the account of a family at the branch, with its child, and gets a link" "$(echo "$SA102" | jq_ "(d['success'], d['data']['link'].startswith('/account/setup/'))")/$(M "SELECT CONCAT(g.signupSource,'/',COUNT(m.id)) FROM Guardian g JOIN FamilyMember m ON m.guardianId=g.id WHERE g.phoneNumber='01033344499' GROUP BY g.id")" "(True, True)/STAFF/1"
check "the link shows the first name only; nothing opens the account before it is used" "$(curl -s $B/api/account/setup/$TOK102 | jq_ "(d['data']['firstName'], 'phone' in d['data'])")" "('Branchmom', False)"
check "the family chooses its password from the link (the phone as password is refused)" "$(curl -s -X POST -H 'Content-Type: application/json' -d '{"password":"01033344499"}' $B/api/account/setup/$TOK102 | jq_ "d['success']")/$(curl -s -X POST -H 'Content-Type: application/json' -d '{"password":"branchPass26"}' $B/api/account/setup/$TOK102 | jq_ "d['success']")" "False/True"
BJ=$(mktemp); login_jar 01033344499 branchPass26 "$BJ" 10.8.2.2
check "…signs in with it and sees its child; the link cannot be used again" "$(curl -s -b "$BJ" $B/api/guardian-portal/family | jq_ "[p['firstName'] for p in d['data']['people']]")/$(curl -s -X POST -H 'Content-Type: application/json' -d '{"password":"otherPass99"}' $B/api/account/setup/$TOK102 | jq_ "d['error']['code']")" "['Branchkid']/LINK_BAD"
rm -f "$BJ"
OLDG=$(M "SELECT id FROM Guardian WHERE phoneNumber='01099988877' LIMIT 1")
check "an old account (made by approving an admission) gets a password link too, and older links stop" "$(api POST /api/family-accounts/$OLDG/link | jq_ "d['data']['link'].startswith('/account/setup/')")/$(api POST /api/family-accounts/$OLDG/link >/dev/null; M "SELECT COUNT(*) FROM AccountSetupLink WHERE guardianId='$OLDG' AND usedAt IS NULL")" "True/1"
SU102=$(curl -s -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.8.3.1" -d "{\"listing\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"who\":\"PARENT\",\"parent\":{\"firstName\":\"Famdad\",\"lastName\":\"Accounttest\",\"phone\":\"01033344455\"},\"city\":\"Hurghada\",\"agree\":true,\"students\":[{\"firstName\":\"Bigone\",\"lastName\":\"Accounttest\",\"dob\":\"2016-04-04\",\"gender\":\"MALE\"}]}" $B/api/public/signup)
AR102=$(M "SELECT id FROM AdmissionRequest WHERE firstName='Bigone' AND lastName='Accounttest' LIMIT 1")
api POST /api/admissions/$AR102/approve "{\"campusId\":\"$ONP\",\"classSectionId\":\"$JG\",\"confirmNotDuplicate\":true}" >/dev/null
check "a request from the same phone, once approved, lands in the SAME family account" "$(echo "$SU102" | jq_ "d['success']")/$(fapi GET /api/guardian-portal/family | jq_ "sorted([(p['firstName'], bool(p['registrationNumber'])) for p in d['data']['people']])")/$(M "SELECT COUNT(*) FROM Guardian WHERE phoneNumber='01033344455'")" "True/[('Bigone', True), ('Littleone', False)]/1"
rm -f "$FJ"
echo "== 103. Booking a course from the family account: hold until paid, expiry, staff approval, codes, waiting list (six phases 1-B, 2026-11-13)"
FJ3=$(mktemp); login_jar 01033344455 famPass2026 "$FJ3" 10.8.4.1
f3() { curl -s -b "$FJ3" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
check "the course page button opens booking inside the account" "$(curl -s "$B/courses/e2e-course" | grep -o 'href="/dashboard/my-children?book=e2e-course"' | head -1)" 'href="/dashboard/my-children?book=e2e-course"'
OPT=$(f3 GET "/api/guardian-portal/family/book?person=m:$FM1&slug=e2e-course")
check "booking options: the opened course starts at its first level and lists the online group with details" "$(echo "$OPT" | jq_ "(d['success'], d['data']['level']['id']=='$LV101', [(g['id']=='$JG', 'price' in g, 'free' in g) for g in (d['data']['online'] or []) if g['id']=='$JG'])")" "(True, True, [(True, True, True)])"
BK1=$(f3 POST /api/guardian-portal/family/book "{\"person\":\"m:$FM1\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"agree\":true}")
BK1ID=$(echo "$BK1" | jq_ "d['data']['id']")
FS1=$(M "SELECT studentId FROM FamilyMember WHERE id='$FM1'")
check "booked: the child becomes a student (TN/…), joins the group, gets the first invoice, the seat is held" "$(echo "$BK1" | jq_ "(d['data']['status'], d['data']['registrationNumber'][:3], d['data']['invoice'] is not None)")/$(M "SELECT COUNT(*) FROM StudentEnrollment WHERE studentId='$FS1' AND classSectionId='$JG' AND status='ACTIVE'")/$(M "SELECT holdUntil > UTC_TIMESTAMP() FROM CourseBooking WHERE id='$BK1ID'")" "('HOLD', 'TN/', True)/1/1"
check "the same child cannot book the same course twice (already learning it)" "$(f3 POST /api/guardian-portal/family/book "{\"person\":\"s:$FS1\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"agree\":true}" | jq_ "d['error']['code']")" "ENROLLED"
BI1=$(M "SELECT invoiceId FROM CourseBooking WHERE id='$BK1ID'")
pay $BI1 $(M "SELECT CAST(totalAmount - paidAmount AS DECIMAL(10,0)) FROM FeeInvoice WHERE id='$BI1'") >/dev/null
check "paid → the booking is confirmed (the family sees it at once)" "$(f3 GET /api/guardian-portal/family/bookings | jq_ "[b['status'] for b in d['data'] if b['id']=='$BK1ID']")" "['CONFIRMED']"
Y9=$(( $(cairo +%Y) - 9 ))
FM3=$(f3 POST /api/guardian-portal/family/members "{\"firstName\":\"Midone\",\"lastName\":\"Accounttest\",\"dob\":\"$Y9-02-02\",\"gender\":\"MALE\"}" | jq_ "d['data']['id']")
BK2ID=$(f3 POST /api/guardian-portal/family/book "{\"person\":\"m:$FM3\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"agree\":true}" | jq_ "d['data']['id']")
FS3=$(M "SELECT studentId FROM FamilyMember WHERE id='$FM3'")
BI2=$(M "SELECT invoiceId FROM CourseBooking WHERE id='$BK2ID'")
M "UPDATE CourseBooking SET holdUntil = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE id='$BK2ID'"
check "not paid in time → expired: out of the group, the unpaid invoice cancelled" "$(f3 GET /api/guardian-portal/family/bookings | jq_ "[b['status'] for b in d['data'] if b['id']=='$BK2ID']")/$(M "SELECT status FROM StudentEnrollment WHERE studentId='$FS3' AND classSectionId='$JG'")/$(M "SELECT status FROM FeeInvoice WHERE id='$BI2'")" "['EXPIRED']/WITHDRAWN/CANCELLED"
check "booking again with 'no time fits' → waiting list; the family can cancel it" "$(f3 POST /api/guardian-portal/family/book "{\"person\":\"s:$FS3\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"agree\":true}" | jq_ "d['data']['status']")/$(M "SELECT COUNT(*) FROM WaitingListEntry WHERE studentId='$FS3' AND status='WAITING' AND classSectionId IS NULL")/$(f3 DELETE /api/guardian-portal/family/bookings/$(M "SELECT id FROM CourseBooking WHERE studentId='$FS3' AND status='WAITING' LIMIT 1") | jq_ "d['success']")/$(M "SELECT COUNT(*) FROM WaitingListEntry WHERE studentId='$FS3' AND status='WAITING'")" "WAITING/1/True/0"
api PUT /api/bookings/rules "{\"scopeType\":\"GROUP\",\"scopeId\":\"$JG\",\"confirm\":\"STAFF\",\"holdHours\":24}" >/dev/null
FM4=$(f3 POST /api/guardian-portal/family/members "{\"firstName\":\"Thirdone\",\"lastName\":\"Accounttest\",\"dob\":\"$Y9-05-05\",\"gender\":\"FEMALE\"}" | jq_ "d['data']['id']")
BK4ID=$(f3 POST /api/guardian-portal/family/book "{\"person\":\"m:$FM4\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"agree\":true}" | jq_ "d['data']['id']")
check "a group rule 'staff approve first': the booking waits, nobody is placed yet; 'your work today' shows it" "$(M "SELECT CONCAT(status,'/',studentId IS NULL) FROM CourseBooking WHERE id='$BK4ID'")/$(api GET /api/today | jq_ "any(t['key']=='bookingsToReview' for t in d['data']['tasks'])")" "REVIEW/1/True"
check "an instructor cannot see or decide bookings" "$(tapi GET /api/bookings | jq_ "d['success']")/$(tapi POST /api/bookings/$BK4ID '{"action":"APPROVE"}' | jq_ "d['success']")" "False/False"
check "a branch secretary cannot decide an online booking (another place); the admin approves → placed and held for 24 hours (the group rule)" "$(secapi POST /api/bookings/$BK4ID '{"action":"APPROVE"}' | jq_ "d['error']['code']")/$(api POST /api/bookings/$BK4ID '{"action":"APPROVE"}' | jq_ "d['data']['status']")/$(M "SELECT TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), holdUntil) BETWEEN 22 AND 24 FROM CourseBooking WHERE id='$BK4ID'")" "NOT_YOURS/HOLD/1"
api DELETE "/api/bookings/rules?id=$(M "SELECT id FROM BookingRule WHERE scopeId='$JG'")" >/dev/null
CB3=$(api POST /api/enrolment-codes "{\"batch\":\"E2EGRP\",\"count\":1,\"kind\":\"PREPAID\",\"scope\":\"GROUP\",\"scopeIds\":[\"$JG\"],\"unlocks\":true,\"maxUses\":3}")
JC3=$(echo "$CB3" | jq_ "d['data']['codes'][0]")
Y5=$(( $(cairo +%Y) - 5 ))
FM5=$(f3 POST /api/guardian-portal/family/members "{\"firstName\":\"Babyone\",\"lastName\":\"Accounttest\",\"dob\":\"$Y5-06-06\",\"gender\":\"FEMALE\"}" | jq_ "d['data']['id']")
check "a 5-year-old cannot book the 8–12 course… unless a code that opens it is used" "$(f3 GET "/api/guardian-portal/family/book?person=m:$FM5&slug=e2e-course" | jq_ "d['error']['code']")/$(f3 GET "/api/guardian-portal/family/book?person=m:$FM5&slug=e2e-course&code=$JC3" | jq_ "d['data']['code']['kind']")" "NOT_SUITABLE/PREPAID"
BK5=$(f3 POST /api/guardian-portal/family/book "{\"person\":\"m:$FM5\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"code\":\"$JC3\",\"agree\":true}")
check "a prepaid group code: the invoice is fully covered → confirmed at once; the code use is counted" "$(echo "$BK5" | jq_ "(d['data']['status'], float(d['data']['invoice']['total']) if d['data']['invoice'] else 0.0)")/$(M "SELECT uses FROM EnrolmentCode WHERE code='$JC3'")" "('CONFIRMED', 0.0)/1"
check "staff see the bookings of the family with their state" "$(api GET /api/bookings | jq_ "sorted(set(b['status'] for b in d['data'] if b['family'] and b['family']['phoneNumber']=='01033344455'))")" "['CANCELLED', 'CONFIRMED', 'EXPIRED', 'HOLD']"
rm -f "$FJ3"
echo "== 104. Track placement ('learned before?'), partner join code + link, group booking link (six phases 1-C, 2026-11-13)"
FJ4=$(mktemp); login_jar 01033344455 famPass2026 "$FJ4" 10.8.5.1
f4() { curl -s -b "$FJ4" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
Y10=$(( $(cairo +%Y) - 10 ))
FM6=$(f4 POST /api/guardian-portal/family/members "{\"firstName\":\"Trackkid\",\"lastName\":\"Accounttest\",\"dob\":\"$Y10-03-03\",\"gender\":\"MALE\"}" | jq_ "d['data']['id']")
check "a full track asks 'learned before?'" "$(f4 GET "/api/guardian-portal/family/book?person=m:$FM6&slug=e2e-track" | jq_ "(d['success'], d['data']['askExperience'], d['data']['course']['refType'])")" "(True, True, 'TRACK')"
BK6=$(f4 POST /api/guardian-portal/family/book "{\"person\":\"m:$FM6\",\"slug\":\"e2e-track\",\"mode\":\"ONLINE\",\"experience\":\"BEFORE\",\"agree\":true}")
BK6ID=$(echo "$BK6" | jq_ "d['data']['id']")
check "'yes, before' → the booking waits for TechNova to set the level; nobody is placed yet" "$(echo "$BK6" | jq_ "d['data']['status']")/$(M "SELECT studentId IS NULL FROM CourseBooking WHERE id='$BK6ID'")/$(api GET /api/today | jq_ "any(t['key']=='bookingsToReview' for t in d['data']['tasks'])")" "PLACEMENT/1/True"
PO=$(api GET /api/bookings/$BK6ID)
check "staff see the track's levels and the groups that fit (online)" "$(echo "$PO" | jq_ "(len(d['data']['levels']) >= 2, any(l['id']=='$LV101' for l in d['data']['levels']), any(g['id']=='$JG' for g in d['data']['groups']))")" "(True, True, True)"
check "a level that is not in the track is refused" "$(api POST /api/bookings/$BK6ID '{"action":"PLACE","levelId":"nope"}' | jq_ "d['error']['code']")" "NO_LEVEL"
check "staff set the level + group → the child is placed and the seat held" "$(api POST /api/bookings/$BK6ID "{\"action\":\"PLACE\",\"levelId\":\"$LV101\",\"groupId\":\"$JG\"}" | jq_ "d['data']['status']")/$(M "SELECT COUNT(*) FROM StudentEnrollment se JOIN FamilyMember m ON m.studentId=se.studentId WHERE m.id='$FM6' AND se.classSectionId='$JG' AND se.status='ACTIVE'")" "HOLD/1"
PCAMP=$(M "SELECT id FROM Campus WHERE kind='PARTNER' AND isActive=1 AND partnerId IS NOT NULL LIMIT 1")
PRT=$(M "SELECT partnerId FROM Campus WHERE id='$PCAMP'")
JN=$(api POST /api/partners/$PRT/join '{"action":"create"}')
PCODE=$(echo "$JN" | jq_ "d['data']['joinCode']")
check "the partner gets a join code + link" "$(echo "$JN" | jq_ "(d['success'], d['data']['path'] == '/join/p/' + d['data']['joinCode'], d['data']['joinActive'])")" "(True, True, True)"
check "the link opens the sign-up with the partner; the sign-up page knows the partner's name" "$(curl -s -o /dev/null -w '%{redirect_url}' $B/join/p/$PCODE | grep -o "/signup?partner=$PCODE")/$(curl -s "$B/api/public/partner-code?code=$PCODE" | jq_ "d['success']")" "/signup?partner=$PCODE/True"
PA4() { curl -s -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: $2" -d "$1" $B/api/public/account; }
check "a family signing up with it is tied to the partner" "$(PA4 "{\"who\":\"PARENT\",\"firstName\":\"Partnermom\",\"lastName\":\"Jointest\",\"phone\":\"01044455566\",\"password\":\"joinPass2026\",\"city\":\"Hurghada\",\"agree\":true,\"partnerCode\":\"$PCODE\"}" 10.8.6.1 | jq_ "d['success']")/$(M "SELECT CONCAT(signupSource,'/',partnerId='$PRT') FROM Guardian WHERE phoneNumber='01044455566'")" "True/PARTNER/1"
PJ=$(mktemp); login_jar 01044455566 joinPass2026 "$PJ" 10.8.6.2
PM=$(curl -s -b "$PJ" -X POST -H 'Content-Type: application/json' -d "{\"firstName\":\"Partnerkid\",\"lastName\":\"Jointest\",\"dob\":\"$Y10-01-01\",\"gender\":\"MALE\"}" $B/api/guardian-portal/family/members | jq_ "d['data']['id']")
check "…and its booking options include the partner's place" "$(curl -s -b "$PJ" "$B/api/guardian-portal/family/book?person=m:$PM&slug=e2e-course" | jq_ "any(b['id']=='$PCAMP' for b in (d['data']['branch'] or []))")/$(f4 GET "/api/guardian-portal/family/book?person=m:$FM6&slug=e2e-course" 2>/dev/null | jq_ "any(b['id']=='$PCAMP' for b in ((d.get('data') or {}).get('branch') or []))")" "True/False"
check "the staff list shows partner families" "$(api GET '/api/family-accounts?filter=PARTNER' | jq_ "[r['partnerName'] is not None for r in d['data'] if r['phoneNumber']=='01044455566']")" "[True]"
api POST /api/partners/$PRT/join '{"action":"off"}' >/dev/null
check "a stopped code: the link opens the normal sign-up, and signing up with it is refused" "$(curl -s -o /dev/null -w '%{redirect_url}' $B/join/p/$PCODE | grep -c partner=)/$(PA4 "{\"who\":\"PARENT\",\"firstName\":\"Latemom\",\"lastName\":\"Jointest\",\"phone\":\"01044455577\",\"password\":\"joinPass2026\",\"city\":\"Hurghada\",\"agree\":true,\"partnerCode\":\"$PCODE\"}" 10.8.6.3 | jq_ "d['error']['code']")" "0/BAD_PARTNER"
api POST /api/partners/$PRT/join '{"action":"on"}' >/dev/null
check "a group's booking link opens the booking of that group inside the account; an unknown group goes to the courses page" "$(curl -s -o /dev/null -w '%{redirect_url}' $B/book/$JG | grep -o "/dashboard/my-children?book=e2e-course&group=$JG")/$(curl -s -o /dev/null -w '%{redirect_url}' $B/book/nope | grep -o '/courses$')" "/dashboard/my-children?book=e2e-course&group=$JG//courses"
LK=$(curl -s -b "$PJ" "$B/api/guardian-portal/family/book?person=m:$PM&slug=e2e-course&group=$JG")
check "opened from the link: the group is chosen for the family" "$(echo "$LK" | jq_ "d['data']['link']['groupId']=='$JG'")" "True"
curl -s -b "$PJ" -X POST -H 'Content-Type: application/json' -d "{\"person\":\"m:$PM\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"link\":\"$JG\",\"agree\":true}" $B/api/guardian-portal/family/book >/dev/null
check "a booking from the link is counted for the group" "$(M "SELECT source FROM CourseBooking WHERE classSectionId='$JG' AND guardianId=(SELECT id FROM Guardian WHERE phoneNumber='01044455566') LIMIT 1")/$(api GET /api/groups/$JG/booking-link | jq_ "(d['data']['slug'], d['data']['bookings'] >= 1)")" "GROUP_LINK/('e2e-course', True)"
check "an instructor cannot read group booking links or partner codes' families" "$(tapi GET /api/groups/$JG/booking-link | jq_ "d['success']")" "False"
rm -f "$FJ4" "$PJ"
echo "== 105. Invite code at sign-up, booking summary (six phases 1-D, 2026-11-13)"
FJ5=$(mktemp); login_jar 01033344455 famPass2026 "$FJ5" 10.8.7.1
RC5=$(curl -s -b "$FJ5" $B/api/referrals/mine | jq_ "d['data']['code']")
check "the family has an invite code; its share text points to the sign-up page" "$(echo "$RC5" | grep -c '^TN-REF-')" "1"
PA5() { curl -s -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: $2" -d "$1" $B/api/public/account; }
check "a friend signs up with the invite code (kept on the account)" "$(PA5 "{\"who\":\"PARENT\",\"firstName\":\"Friendmom\",\"lastName\":\"Invitetest\",\"phone\":\"01055566677\",\"password\":\"invPass2026\",\"city\":\"Hurghada\",\"agree\":true,\"referral\":\"$RC5\"}" 10.8.7.2 | jq_ "d['success']")/$(M "SELECT referredBy='$RC5' FROM Guardian WHERE phoneNumber='01055566677'")" "True/1"
IJ=$(mktemp); login_jar 01055566677 invPass2026 "$IJ" 10.8.7.3
IM=$(curl -s -b "$IJ" -X POST -H 'Content-Type: application/json' -d "{\"firstName\":\"Friendkid\",\"lastName\":\"Invitetest\",\"dob\":\"$Y10-04-04\",\"gender\":\"FEMALE\"}" $B/api/guardian-portal/family/members | jq_ "d['data']['id']")
IB=$(curl -s -b "$IJ" -X POST -H 'Content-Type: application/json' -d "{\"person\":\"m:$IM\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"agree\":true}" $B/api/guardian-portal/family/book | jq_ "d['data']['id']")
check "the first booking makes the student and links the referral to the friend who invited" "$(M "SELECT COUNT(*) FROM Referral r JOIN FamilyMember m ON m.studentId=r.referredStudentId WHERE m.id='$IM' AND r.referrerGuardianId='$FG102'")" "1"
check "the booking summary: the family that booked and staff can read it; another family and an instructor cannot" "$(curl -s -b "$IJ" $B/api/bookings/$IB/summary | jq_ "(d['success'], d['data']['who'])")/$(api GET /api/bookings/$IB/summary | jq_ "d['success']")/$(curl -s -b "$FJ5" $B/api/bookings/$IB/summary | jq_ "d['success']")/$(tapi GET /api/bookings/$IB/summary | jq_ "d['success']")" "(True, 'Friendkid Invitetest')/True/False/False"
check "the printable summary page opens" "$(curl -s -o /dev/null -w '%{http_code}' -b "$IJ" $B/reports/booking/$IB)" "200"
rm -f "$FJ5" "$IJ"
echo "== 106. Joining a group only after payment, staff 'let in without payment', family reminders (six phases E, 2026-11-13)"
check "a group rule 'only after payment' is saved; a secretary cannot change group policies" "$(api PUT /api/group-policies "{\"scopeType\":\"GROUP\",\"scopeId\":\"$JG\",\"entry\":\"AFTER_PAYMENT\"}" | jq_ "d['data']['entry']")/$(secapi PUT /api/group-policies '{"scopeType":"COMPANY","entry":"NOW"}' | jq_ "d['success']")" "AFTER_PAYMENT/False"
FJ6=$(mktemp); login_jar 01033344455 famPass2026 "$FJ6" 10.8.8.1
f6() { curl -s -b "$FJ6" -X "$1" -H 'Content-Type: application/json' ${3:+-d "$3"} "$B$2"; }
SEATS0=$(api GET /api/groups/$JG | jq_ "d['data']['seats']['count']")
FM7=$(f6 POST /api/guardian-portal/family/members "{\"firstName\":\"Paylater\",\"lastName\":\"Accounttest\",\"dob\":\"$Y9-08-08\",\"gender\":\"MALE\"}" | jq_ "d['data']['id']")
BK7ID=$(f6 POST /api/guardian-portal/family/book "{\"person\":\"m:$FM7\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"agree\":true}" | jq_ "d['data']['id']")
FS7=$(M "SELECT studentId FROM FamilyMember WHERE id='$FM7'")
check "booked in an 'after payment' group: the seat is held (counts in the seats) but the child is not in the group yet" "$(M "SELECT status FROM StudentEnrollment WHERE studentId='$FS7' AND classSectionId='$JG'")/$(( $(api GET /api/groups/$JG | jq_ "d['data']['seats']['count']") - SEATS0 ))/$(api GET "/api/enrollment-attendance/roster?classSectionId=$JG&date=$(D 0)" | jq_ "any(e['student']['id']=='$FS7' for e in d['data']['enrollments'])")" "AWAITING_PAYMENT/1/False"
check "the group page lists who waits to pay; 'your work today' too" "$(api GET /api/groups/$JG/awaiting | jq_ "(d['data']['policy']['entry'], [s['studentId']=='$FS7' for s in d['data']['students']].count(True))")/$(api GET /api/today | jq_ "any(t['key']=='studentsAwaitingPayment' for t in d['data']['tasks'])")" "('AFTER_PAYMENT', 1)/True"
M "UPDATE CourseBooking SET holdUntil = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR) WHERE id='$BK7ID'"
f6 GET /api/guardian-portal/family/bookings >/dev/null
check "the family is reminded before the seat is let go (3-hour reminder)" "$(M "SELECT remindersSent FROM CourseBooking WHERE id='$BK7ID'")/$(M "SELECT COUNT(*)>0 FROM Notification WHERE type='BOOKING_UPDATE' AND relatedId='$BK7ID' AND title LIKE 'Last hours%'")" "2/1"
BI7=$(M "SELECT invoiceId FROM CourseBooking WHERE id='$BK7ID'")
pay $BI7 $(M "SELECT CAST(totalAmount - paidAmount AS DECIMAL(10,0)) FROM FeeInvoice WHERE id='$BI7'") >/dev/null
check "paid → the child joins the group by itself (in the attendance sheet) and the booking is confirmed" "$(M "SELECT status FROM StudentEnrollment WHERE studentId='$FS7' AND classSectionId='$JG'")/$(api GET "/api/enrollment-attendance/roster?classSectionId=$JG&date=$(D 0)" | jq_ "any(e['student']['id']=='$FS7' for e in d['data']['enrollments'])")/$(f6 GET /api/guardian-portal/family/bookings | jq_ "[b['status'] for b in d['data'] if b['id']=='$BK7ID']")" "ACTIVE/True/['CONFIRMED']"
AD=$(api POST /api/groups/$JG/students "{\"studentId\":\"$FS3\"}")
check "staff add a student to the 'after payment' group → held until paid" "$(echo "$AD" | jq_ "d['data']['awaitingPayment']")/$(M "SELECT status FROM StudentEnrollment WHERE studentId='$FS3' AND classSectionId='$JG'")" "True/AWAITING_PAYMENT"
check "a secretary cannot let him in without payment; the admin can" "$(secapi POST /api/groups/$JG/awaiting "{\"studentId\":\"$FS3\",\"action\":\"OPEN\"}" | jq_ "d['success']")/$(api POST /api/groups/$JG/awaiting "{\"studentId\":\"$FS3\",\"action\":\"OPEN\"}" | jq_ "d['success']")/$(M "SELECT status FROM StudentEnrollment WHERE studentId='$FS3' AND classSectionId='$JG'")" "False/True/ACTIVE"
FM8=$(f6 POST /api/guardian-portal/family/members "{\"firstName\":\"Wontpay\",\"lastName\":\"Accounttest\",\"dob\":\"$Y9-09-09\",\"gender\":\"FEMALE\"}" | jq_ "d['data']['id']")
BK8ID=$(f6 POST /api/guardian-portal/family/book "{\"person\":\"m:$FM8\",\"slug\":\"e2e-course\",\"mode\":\"ONLINE\",\"groupId\":\"$JG\",\"agree\":true}" | jq_ "d['data']['id']")
FS8=$(M "SELECT studentId FROM FamilyMember WHERE id='$FM8'")
check "staff remove a waiting student → out, unpaid invoice cancelled, booking cancelled" "$(api POST /api/groups/$JG/awaiting "{\"studentId\":\"$FS8\",\"action\":\"REMOVE\"}" | jq_ "d['success']")/$(M "SELECT status FROM StudentEnrollment WHERE studentId='$FS8' AND classSectionId='$JG'")/$(M "SELECT f.status FROM FeeInvoice f JOIN CourseBooking b ON b.invoiceId=f.id WHERE b.id='$BK8ID'")/$(M "SELECT status FROM CourseBooking WHERE id='$BK8ID'")" "True/WITHDRAWN/CANCELLED/CANCELLED"
api DELETE "/api/group-policies?id=$(M "SELECT id FROM GroupPolicy WHERE scopeId='$JG'")" >/dev/null
check "without the rule the group is joined at once again" "$(M "SELECT COUNT(*) FROM GroupPolicy WHERE scopeId='$JG'")" "0"
rm -f "$FJ6"
echo
echo "RESULT: $PASS passed, $FAIL failed"
grep -E "⨯|Error:" /d/tn-e2e-app.log | grep -v webpackBuildWorker | head -5
[ $FAIL -eq 0 ]
