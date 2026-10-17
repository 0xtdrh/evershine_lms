// e2e helper (phase 6): fill a downloaded TechNova Excel template.
// node scripts/e2e/fill-template.cjs <template.xlsx> <out.xlsx> <rows.json>
// rows.json = [{ "<English column name>": value, ... }, ...] — matched to the header "English * | عربي".
const ExcelJS = require('exceljs')
const fs = require('fs')

async function main() {
  const [tpl, out, rowsFile] = process.argv.slice(2)
  const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8'))
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(tpl)
  const sheet = wb.worksheets.find((s) => s.state === 'visible')
  const header = sheet.getRow(1)
  const cols = {}
  header.eachCell((cell, n) => {
    const en = String(cell.value).split('|')[0].replace('*', '').trim().toLowerCase()
    cols[en] = n
  })
  rows.forEach((r, i) => {
    for (const [k, v] of Object.entries(r)) {
      const n = cols[k.toLowerCase()]
      if (!n) throw new Error(`column not found: ${k}`)
      sheet.getCell(i + 2, n).value = v
    }
  })
  await wb.xlsx.writeFile(out)
}
main().catch((e) => { console.error(e.message); process.exit(1) })
