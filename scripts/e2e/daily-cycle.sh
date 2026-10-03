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
  sleep 3; rm -rf "$DATA_DIR" "$JAR" /d/tn-e2e-restore.sql /d/tn-e2e-app.log /d/tn-e2e-p*.txt
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
DATABASE_URL="$URL" AUTH_SECRET="$SECRET" NEXTAUTH_SECRET="$SECRET" NEXTAUTH_URL="$B" PAYMOB_HMAC_SECRET="e2e-paymob-hmac" npx next dev -p $APP_PORT > /d/tn-e2e-app.log 2>&1 &
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
R=$(api POST /api/fees/$LATE2/pay-from-wallet '{}')
check "next invoice paid from the wallet (448.75)" "$(echo "$R" | jq_ "d['data']['amount']")" "448.75"
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
echo
echo "RESULT: $PASS passed, $FAIL failed"
grep -E "⨯|Error:" /d/tn-e2e-app.log | grep -v webpackBuildWorker | head -5
[ $FAIL -eq 0 ]
