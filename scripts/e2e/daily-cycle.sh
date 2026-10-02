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

echo
echo "RESULT: $PASS passed, $FAIL failed"
grep -E "⨯|Error:" /d/tn-e2e-app.log | grep -v webpackBuildWorker | head -5
[ $FAIL -eq 0 ]
