'use client'

type Cell = string | number | null
export interface SheetSpec {
  name: string
  title?: string
  header: string[]
  rows: Cell[][]
  /** column indexes to format as ₹ */
  money?: number[]
  widths?: number[]
}

/** Builds an .xlsx in the browser and downloads it. */
export async function downloadXlsx(filename: string, sheets: SheetSpec[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'DrKitchen Sales'

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31))
    let r = 1
    if (s.title) {
      ws.getCell(r, 1).value = s.title
      ws.getCell(r, 1).font = { bold: true, size: 13 }
      r += 2
    }
    const headerRow = ws.getRow(r)
    s.header.forEach((h, i) => {
      const c = headerRow.getCell(i + 1)
      c.value = h
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC2410C' } }
      c.alignment = { vertical: 'middle', wrapText: true }
    })
    ws.views = [{ state: 'frozen', ySplit: r }]
    for (const row of s.rows) {
      r += 1
      const xr = ws.getRow(r)
      row.forEach((v, i) => {
        const c = xr.getCell(i + 1)
        c.value = v
        if (s.money?.includes(i)) c.numFmt = '₹#,##,##0.00'
      })
    }
    s.header.forEach((h, i) => {
      ws.getColumn(i + 1).width = s.widths?.[i] ?? Math.max(10, Math.min(28, h.length + 2))
    })
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
