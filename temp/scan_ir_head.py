import openpyxl

wb = openpyxl.load_workbook('TG-1冷凝器銅管管板.xlsx', data_only=True)
sheet = wb.worksheets[0]

TUBE_COLORS = {'FF00B0F0', 'FF0070C0'}

# 只掃描頭幾行（52-70），確認是否有大空缺
print("=== Bottom Half Right Side: Row 52-70, looking for internal gaps > 4 ===")

for r in range(52, 71):
    # Find all colored columns in right half
    colored = []
    for c in range(99, 201):
        cell = sheet.cell(row=r, column=c)
        color = '00000000'
        if cell.fill and cell.fill.fgColor and cell.fill.fgColor.rgb:
            color = str(cell.fill.fgColor.rgb)
        if color in TUBE_COLORS:
            colored.append(c)
    
    # Find gaps
    gaps = []
    for i in range(len(colored)-1):
        gap = colored[i+1] - colored[i]
        if gap > 4:
            gaps.append((colored[i], colored[i+1], gap))
    
    cnt = len(colored)
    if gaps:
        print(f"Row {r:3d}: {cnt:3d} tubes, BIG GAPS: {gaps}")
    else:
        print(f"Row {r:3d}: {cnt:3d} tubes, no big gaps")
