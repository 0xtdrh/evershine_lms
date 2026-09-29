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
DATABASE_URL="$URL" npx prisma db push --skip-generate >/dev/null 2>&1 || { echo "schema push failed"; exit 1; }
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
DATABASE_URL="$URL" AUTH_SECRET="$SECRET" NEXTAUTH_SECRET="$SECRET" NEXTAUTH_URL="$B" npx next dev -p $APP_PORT > /d/tn-e2e-app.log 2>&1 &
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

echo
echo "RESULT: $PASS passed, $FAIL failed"
grep -E "⨯|Error:" /d/tn-e2e-app.log | grep -v webpackBuildWorker | head -5
[ $FAIL -eq 0 ]
