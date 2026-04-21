import json

def generate_precise_lookup():
    with open('detailed_grid.json', 'r') as f:
        data = json.load(f)
    
    grid = data['grid']
    centerX = 92 # We found col 92 is the potential center in detailed_grid.json (relative to min_col)
    
    lookup = {
        "TOP": [], # Will cover OR/OL (Grid Rows 0 to 49/50)
        "BOTTOM": [] # Will cover IR/IL (Grid Rows 51+)
    }
    
    # Process Row by Row
    for r_idx, row in enumerate(grid):
        # Find all colored blocks in the right half (from centerX+1 onwards)
        right_tubes = []
        for c_idx in range(centerX + 1, len(row)):
            if row[c_idx] == 1:
                # Calculate physical X. We know from previous analysis that tubes are 2 grid units apart visualy.
                # However, to be extra precise, we'll just store the raw grid index relative to center.
                # Let's use the same spacing logic as before but store it row-by-row.
                right_tubes.append(c_idx - centerX)
        
        # Categorize into TOP (OR/OL) or BOTTOM (IR/IL)
        # Based on analysis: Grid Rows 0-49 maps to OR 1-50
        # Grid Row 50-51 are equator, Grid Row 52+ maps to IR 1+
        if r_idx <= 49:
            lookup["TOP"].append(right_tubes)
        elif r_idx >= 52:
            lookup["BOTTOM"].append(right_tubes)
        else:
            # Equatorial transition (50, 51)
            # We'll attach them to TOP or BOTTOM depending on count or just treat them as gap-fillers
            # For now, let's just keep them in a separate transition list to decide later
            if "TRANSITION" not in lookup: lookup["TRANSITION"] = []
            lookup["TRANSITION"].append(right_tubes)

    with open('lookup_precise.json', 'w') as f:
        json.dump(lookup, f, indent=2)
    
    print("Saved lookup_precise.json")

if __name__ == "__main__":
    generate_precise_lookup()
