import json

def analyze_grid():
    with open('detailed_grid.json', 'r') as f:
        data = json.load(f)
    
    grid = data['grid']
    rows = len(grid)
    cols = len(grid[0])
    
    print(f"Grid size: {rows} rows x {cols} cols")
    
    # Analyze row by row tube counts
    row_counts = [sum(row) for row in grid]
    for i, count in enumerate(row_counts):
        print(f"Row {i:2d} (Original Row {data['min_row']+i}): {count:3d} tubes")

    # Find the vertical center candidates
    col_counts = [sum(grid[r][c] for r in range(rows)) for c in range(cols)]
    
    # The center is usually a near-empty column
    potential_center = []
    for c in range(10, cols - 10):
        if col_counts[c] < 5:
            potential_center.append(c)
    
    print(f"Potential vertical centers (cols with few/no tubes): {potential_center}")

if __name__ == "__main__":
    analyze_grid()
