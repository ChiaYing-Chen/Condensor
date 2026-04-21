import openpyxl

wb = openpyxl.load_workbook('TG-1冷凝器銅管管板.xlsx', data_only=True)
sheet = wb.worksheets[0]

colors = set()

print("Checking center of bottom half (Row 60-80, Col 80-120):")
for r in range(60, 80):
    row_colors = []
    for c in range(80, 120):
        cell = sheet.cell(row=r, column=c)
        if cell.fill and cell.fill.fgColor and cell.fill.fgColor.rgb:
            color = str(cell.fill.fgColor.rgb)
            row_colors.append(color)
            colors.add(color)
        else:
            row_colors.append("None")
    
    # Just print the middle row to inspect
    if r == 70:
       print("Row 70 colors:", row_colors)

print("\nAll unique colors found in this block:")
print(colors)
