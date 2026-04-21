import openpyxl
import json

def extract_shape():
    print("Loading workbook...")
    wb = openpyxl.load_workbook('TG-1冷凝器銅管管板.xlsx', data_only=True)
    sheet = wb['113年大修後']
    
    print("Extracting cell colors...")
    grid = []
    
    # Let's define the bounding box of the visual drawing based on my earlier probe.
    # It has about 102 rows, 238 cols.
    for row in range(1, 105):
        row_data = []
        for col in range(1, 240):
            cell = sheet.cell(row=row, column=col)
            # Check if cell has a background fill that is NOT white/transparent
            # fgColor is the foreground of the fill (i.e. the solid background color)
            has_fill = False
            if cell.fill and cell.fill.fgColor and cell.fill.fgColor.rgb:
                color = str(cell.fill.fgColor.rgb)
                # Ignore white or completely transparent
                if color != '00000000' and color != 'FFFFFFFF' and color != '00FFFFFF':
                    has_fill = True
            row_data.append(1 if has_fill else 0)
        grid.append(row_data)
        
    print("Calculating boundaries and mapping tubes...")
    
    # We need to map the physical colored grid cells back to (Zone, Row, Col)
    # The image is highly symmetrical.
    
    # Save the raw boolean grid to map dynamically
    with open('grid_shape.json', 'w') as f:
        json.dump(grid, f)
        
    print("Saved grid_shape.json")

if __name__ == "__main__":
    extract_shape()
