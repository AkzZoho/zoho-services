# Zoho Creator — Reports

> Reports are **views** over form data. They are not separate databases — they read from forms.
> Every form gets a default **List** report auto-created by Creator.

---

## Report Types

| Type | Creator UI Name | Best For |
|---|---|---|
| **list** | List Report | Standard tabular view of records; most common |
| **grid** | Grid View | Spreadsheet-like inline editing |
| **summary** | Summary Report | Grouped/aggregated data with sub-totals |
| **kanban** | Kanban View | Cards grouped by a status/dropdown field; drag to update status |
| **calendar** | Calendar View | Records displayed on a date-based calendar |
| **timeline** | Timeline View | Gantt-like view for date-range fields |
| **map** | Map View | Records plotted on a geographic map (uses Address or Lat/Long fields) |
| **pivot** | Pivot Table | Cross-tabulated data (rows × columns × aggregate) |
| **spreadsheet** | Spreadsheet View | Excel-like view; supports inline editing |

---

## Report Anatomy

```
Report
├── Base Form          — which form's data it reads
├── Columns            — which fields to show (configurable per device)
├── Criteria           — filter conditions (e.g. Status == "Active")
├── Sort               — default sort field and direction
├── Group By           — for summary/kanban/pivot
├── Quick View         — mini card layout (kanban)
├── Conditional Formatting — highlight rows by field values
├── Custom Actions     — buttons on records (Deluge-powered)
├── Bulk Actions       — buttons on selected records
└── Report-level Permissions — who can View/Edit/Delete/Export
```

---

## Custom Actions (Deluge on Reports)

Custom actions appear as **buttons on each record row** in a report. They run Deluge:

```deluge
// Custom Action on "All_Orders" report — called "Mark as Shipped"
// input.ID is the record ID of the clicked row

rec = Orders[ID == input.ID];
rec.Status = "Shipped";
rec.Shipped_Date = zoho.currentdate;

sendmail
[
    from: zoho.adminuserid
    to: rec.Customer_Email
    subject: "Your Order has been Shipped"
    message: "Order " + rec.Order_Number + " is on its way!"
]

openUrl("#Report:All_Orders", "same window");
```

---

## Report Permissions (inside `share_settings`)

Reports inherit access from their base form's profile permissions. You can also set per-report actions:

```
Report Access Actions:
  View     — can open and read the report
  Edit     — can edit records inline from the report
  Delete   — can delete records from the report
  Export   — can export to CSV/XLS/PDF
```

---

## Kanban-specific configuration

- **Group by:** must be a Dropdown, Radio, or Checkbox field
- **Card fields:** up to ~5 fields shown on each card
- Drag-and-drop between columns updates the group-by field value automatically

---

## Calendar-specific configuration

- **Event title field:** a text field
- **Start date field:** a Date or Date-Time field
- **End date field:** optional; same type as start
- Clicking a slot opens the form to create a new record with that date pre-filled

---

## Summary Report Groupings

- Can group by 1–3 fields (nested grouping)
- Aggregates: Count, Sum, Average, Min, Max
- Sub-totals and grand totals auto-calculated

---

## Map View requirements

- Form must have an **Address** field OR separate **Latitude** + **Longitude** (Decimal) fields
- Records are plotted as pins; clicking a pin shows record details

---

## When to Generate Which Report Type

| Scenario in BRD | Report Type |
|---|---|
| "List of all orders" / "View all customers" | `list` |
| "Track request status visually" | `kanban` |
| "Monthly sales summary by region" | `summary` |
| "Schedule view of events" | `calendar` |
| "Project timeline" | `timeline` |
| "Field technician locations" | `map` |
| "Revenue by product by month" | `pivot` |
| "Bulk edit inventory" | `grid` or `spreadsheet` |

---

## Deluge in Reports — Possible Touches

| Surface | Deluge Hook |
|---|---|
| **Custom Action** | Full Deluge script; `input.ID` = clicked record ID |
| **Bulk Action** | Deluge script; `input.ID` = list of selected record IDs |
| **Report-level button** (Page embed) | Navigate to report via `openUrl("#Report:Name", ...)` |
