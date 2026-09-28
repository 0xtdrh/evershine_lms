# Backup يدوي لقاعدة Railway (Windows)

الملف اللي هيطلع فيه كل بيانات النظام (أولياء أمور، حسابات، فلوس). **متحطوش جوه فولدر المشروع أبدًا، ومتبعتوش لحد.**

## 1) تنزيل MySQL client (مرة واحدة)

1. افتح: https://dev.mysql.com/downloads/mysql/
2. اختار **MySQL Community Server 8.4 LTS**، ونظام **Microsoft Windows**.
3. نزّل **Windows (x86, 64-bit), ZIP Archive** (مش الـ MSI Installer).
   لو ظهرتلك صفحة Login اضغط **"No thanks, just start my download"**.
4. فك الضغط، وسمّي الفولدر `D:\mysql` (على D: مش C:، لأن C: مليان)، بحيث يبقى عندك الملف ده:
   `D:\mysql\bin\mysqldump.exe`
5. اعمل فولدر للنسخ **برّه المشروع**: `D:\TechNovaBackups`

> نفس الـ ZIP ده فيه MySQL server كامل، وهنستخدمه بعدين في اختبار الـ Restore على الجهاز.

## 2) بيانات الاتصال من Railway

1. ادخل Railway → المشروع → اضغط على خدمة **MySQL**.
2. تاب **Variables** → دوّر على **`MYSQL_PUBLIC_URL`** واضغط على العين عشان يظهر.
   شكله كده: `mysql://root:PASSWORD@XXXX.proxy.rlwy.net:12345/railway`
3. طلّع منه 4 حاجات:
   - **HOST** = الجزء بعد `@` ولحد `:`، مثال: `XXXX.proxy.rlwy.net`
   - **PORT** = الرقم بعد `:`، مثال: `12345`
   - **USER** = غالبًا `root`
   - **DB** = آخر كلمة بعد `/`، غالبًا `railway`
   - الباسورد هتكتبه لما يطلبه منك، ومش هيظهر على الشاشة وانت بتكتبه.

> مهم: استخدم الـ **PUBLIC** URL، مش `MYSQL_URL` (ده شغال جوه شبكة Railway بس).

## 3) الأمر (PowerShell)

بدّل HOST وPORT وDB، وسيب `-p` زي ما هو من غير باسورد:

```powershell
& "D:\mysql\bin\mysqldump.exe" -h HOST -P PORT -u root -p --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 --result-file="D:\TechNovaBackups\technova-2026-09-28.sql" DB
```

- هيسألك `Enter password:`. الصق الباسورد (Right-click) واضغط Enter.
- **لازم** تستخدم `--result-file`، ومتستخدمش `>`. الـ `>` في PowerShell بيبوّظ ترميز الملف.
- الأمر ده بيقرا بس، ومش بيغيّر أي حاجة في القاعدة.

## 4) اتأكد إن الملف كامل

**أ) آخر سطر في الملف** لازم يبقى `-- Dump completed on ...`:
```powershell
Get-Content "D:\TechNovaBackups\technova-2026-09-28.sql" -Tail 1
```

**ب) عدد الجداول في الملف:**
```powershell
(Select-String -Path "D:\TechNovaBackups\technova-2026-09-28.sql" -Pattern '^CREATE TABLE').Count
```

**ج) عدد الجداول في القاعدة نفسها** (لازم يطلع نفس رقم ب):
```powershell
& "D:\mysql\bin\mysql.exe" -h HOST -P PORT -u root -p -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='DB' AND table_type='BASE TABLE';"
```

**د) حجم الملف** (لازم ميبقاش 0):
```powershell
(Get-Item "D:\TechNovaBackups\technova-2026-09-28.sql").Length / 1KB
```

لو (أ) طلع صح و(ب) = (ج)، يبقى الملف كامل. الاختبار النهائي هو الـ Restore على قاعدة محلية، وهنعمله بعدين.

## 5) بعد كده

- خد نسخة من الملف على مكان تاني (فلاشة أو Drive خاص)، ويُفضّل تضغطه بـ 7-Zip بباسورد.
- متحطوش في فولدر المشروع، ومتعملوش commit.
