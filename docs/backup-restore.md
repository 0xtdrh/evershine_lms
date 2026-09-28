# Backup: الأنواع وطريقة الـ Restore

## أنواع النسخ
| النوع | إمتى | فين | الشكل |
|---|---|---|---|
| Backup يومي جوه التطبيق | كل يوم `0 1 * * *` UTC (4 الفجر بتوقيت مصر في الصيفي، 3 الفجر في الشتوي). Vercel Hobby ممكن يشغّله في أي وقت جوه الساعة دي | Cloudinary (authenticated، من غير لينك عام)، آخر 7 نسخ | `technova-<وقت UTC>.sql.gz` |
| يدوي من الصفحة | زرار «Back up now» في `/dashboard/admin/backups` | نفس المكان، والاسم آخره `-manual` | نفس الشكل |
| mysqldump من جهازك | وقت ما تحب (`docs/backup-manual-dump.md`) | جهازك (`D:\TechNovaBackups`) | `.sql` |

التنزيل من الصفحة لـ **SUPER_ADMIN بس**، والصلاحية بتتراجع من الـ database في كل طلب. اللينك صالح لمدة دقيقتين، وكل تنزيل بيتسجّل في الـ Audit Log.
لو الـ backup اليومي فشل، كل الـ SUPER_ADMIN بيجيلهم notification، والصفحة بتعمل تحذير أحمر لو آخر نسخة عدّى عليها أكتر من 26 ساعة.

## اختبار نسخة (ده مش بيلمس Railway)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 -DumpFile "D:\TechNovaBackups\<file>.sql.gz"
```
السكريبت بيشغّل MySQL مؤقت على جهازك، ويعمل restore في قاعدة فاضية، ويقارن عدد الصفوف في كل جدول بالأعداد المكتوبة جوه الملف. في الآخر بيمسح كل حاجة عملها.
لو زودت `-CompareLive`، بيقارن كمان بـ Railway، بـ `SELECT COUNT(*)` بس جوه transaction للقراءة فقط (READ ONLY).

## Restore حقيقي (لو حصلت مصيبة)
**القاعدة الأولى: متعملش restore فوق الـ database الشغالة من غير ما تاخد dump منها الأول.** (استخدم الخطوات اللي في `docs/backup-manual-dump.md`.)

الطريقة الآمنة إنك تعمل database جديدة:
1. في Railway: اعمل خدمة **MySQL جديدة** في نفس المشروع، وخد الـ `MYSQL_PUBLIC_URL` بتاعها.
2. لو الملف `.gz`، فك ضغطه الأول بـ 7-Zip.
3. اعمل الـ restore في القاعدة الجديدة:
   ```powershell
   & "D:\mysql\bin\mysql.exe" -h NEW_HOST -P NEW_PORT -u root -p --default-character-set=utf8mb4 railway -e "source D:/TechNovaBackups/<file>.sql"
   ```
   (في المسار استخدم `/` مش `\`.)
4. شغّل `restore-test.ps1` بـ `-CompareLive` على القاعدة الجديدة، واتأكد إن عدد الصفوف مطابق.
5. في Vercel: غيّر `DATABASE_URL` للقاعدة الجديدة، واعمل Redeploy.
6. سيب القاعدة القديمة زي ما هي لحد ما تتأكد إن كل حاجة سليمة.

## اختبار اتعمل (2026-09-28)
- عملت قاعدة محلية فيها الـ schema كامل (111 جدول) وبيانات seed، وجدول فيه قيم صعبة: عربي، emoji، علامات تنصيص، backslash، سطور جديدة، JSON، DECIMAL، DATETIME(3)، TIMESTAMP، BLOB، BIT، NULL، ونص طوله 700KB.
- عملت restore لنسخة التطبيق (`createSqlDump`)، ولنسخة `mysqldump`، كل واحدة في قاعدة فاضية.
- النتيجة: **الـ 111 جدول نفس عدد الصفوف ونفس `CHECKSUM TABLE`** في الطريقتين، يعني المحتوى متطابق بالظبط.
- جربت كمان إن الاختبار نفسه شغال: غيّرت حرف واحد في النسخة المسترجعة، والـ checksum اتغير.
- اللي **لسه متجربش**: الرفع على Cloudinary والتنزيل منه. محتاجين نجربهم على الموقع الحقيقي بعد الـ deploy.

## حدود لازم نعرفها
- Vercel Hobby: الـ function حدها 60 ثانية، والـ dump نفسه حدّه 40 ثانية. لو الـ database كبرت وقرّبت من الحد ده، هنحتاج نغيّر الطريقة.
- Cloudinary المجاني: أقصى حجم للملف الواحد 10MB بعد الضغط. لو قرّبنا منه، هننقل التخزين لـ Vercel Blob أو R2.
