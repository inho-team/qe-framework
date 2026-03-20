---
name: Qxlsx
description: "All tasks related to spreadsheet files (.xlsx, .xlsm, .csv, .tsv). Use when opening, reading, editing, or creating spreadsheets, Excel files, formulas, formatting, charts, and data cleanup."
metadata:
  source: https://skills.sh/anthropics/skills/xlsx
  author: anthropic
---


# XLSX Creation, Editing, and Analysis

## CRITICAL: Use Formulas, Not Hardcoded Values
```python
# WRONG
sheet['B10'] = df['Sales'].sum()
# CORRECT
sheet['B10'] = '=SUM(B2:B9)'
```

## Financial Models - Color Coding
- **Blue text**: Hardcoded inputs
- **Black text**: Formulas/calculations
- **Green text**: Links from other worksheets
- **Yellow background**: Key assumptions

## Reading with pandas
```python
import pandas as pd
df = pd.read_excel('file.xlsx')
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)
```

## Creating with openpyxl
```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
wb = Workbook()
sheet = wb.active
sheet['A1'] = 'Hello'
sheet['B2'] = '=SUM(A1:A10)'
sheet['A1'].font = Font(bold=True)
wb.save('output.xlsx')
```

## Editing Existing
```python
from openpyxl import load_workbook
wb = load_workbook('existing.xlsx')
sheet = wb.active
sheet['A1'] = 'New Value'
wb.save('modified.xlsx')
```

## Recalculate Formulas (MANDATORY)
```bash
python scripts/recalc.py output.xlsx
```

## Best Practices
- **pandas**: Data analysis, bulk operations
- **openpyxl**: Formatting, formulas, Excel-specific features
- Cell indices are 1-based
- `data_only=True` reads values (WARNING: saving loses formulas)
- Years as text ("2024" not "2,024")
- Negative numbers: parentheses (123) not -123
