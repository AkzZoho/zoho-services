# Zoho Creator — Schedules

> Schedules are **time-triggered Deluge scripts** that run automatically at configured intervals.
> They have no UI trigger — they run as the **application owner (admin user)** in the background.

---

## Schedule Configuration

| Setting | Options |
|---|---|
| **Name** | Identifier for the schedule |
| **Run frequency** | Once / Hourly / Daily / Weekly / Monthly / Yearly / Custom (cron-like) |
| **Date/Time** | Specific start datetime |
| **Criteria** | Optional — run only if a condition is met |
| **Action** | Deluge script |

---

## Frequency Options

| Frequency | When it runs |
|---|---|
| **Once** | Runs once at the specified date/time |
| **Hourly** | Every N hours |
| **Daily** | Every day at a specified time |
| **Weekly** | Specific day(s) of the week at a specified time |
| **Monthly** | Specific day of the month at a specified time |
| **Yearly** | Specific date each year |
| **Custom** | Advanced interval (e.g. every 15 minutes) |

---

## Schedule Deluge Context

Inside a Schedule script:
- `zoho.adminuser` — application owner username
- `zoho.adminuserid` — application owner email
- `zoho.currentdate` — today's date
- `zoho.currenttime` — current date+time
- **NO `input.*`** — there is no submitted form; you must query data yourself

---

## Complete Schedule Examples

### Example 1: Daily Overdue Invoice Reminder

```deluge
// Schedule: Send_Overdue_Reminders | Frequency: Daily at 09:00
// Purpose: Email customers with unpaid invoices past their due date

today = zoho.currentdate;

for each invoice in Invoices [Status == "Unpaid" && Due_Date < today]
{
    // Send reminder email
    sendmail
    [
        from: zoho.adminuserid
        to: invoice.Customer_Email
        subject: "Payment Reminder — Invoice " + invoice.Invoice_Number + " is Overdue"
        message: "<p>Dear " + invoice.Customer_Name + ",</p>" +
                 "<p>Your invoice <b>" + invoice.Invoice_Number + "</b> for <b>" + invoice.Amount + "</b> " +
                 "was due on <b>" + invoice.Due_Date.toString("dd-MMM-yyyy") + "</b> and remains unpaid.</p>" +
                 "<p>Please make payment at your earliest convenience.</p>" +
                 "<p>Thank you.</p>"
    ]

    // Update reminder sent count
    invoice.Reminders_Sent = invoice.Reminders_Sent + 1;
    invoice.Last_Reminder_Date = today;
}
```

### Example 2: Weekly Report Email to Management

```deluge
// Schedule: Weekly_Management_Report | Frequency: Weekly on Monday at 08:00
// Purpose: Send weekly summary of new orders to management

weekStart = zoho.currentdate.subDay(7);
newOrders = Orders[Added_Time >= weekStart].count();
totalRevenue = Orders[Added_Time >= weekStart].Order_Amount.sum();
pendingOrders = Orders[Status == "Pending"].count();

reportBody = "<h2>Weekly Operations Report</h2>" +
             "<table border='1' cellpadding='5'>" +
             "<tr><td><b>New Orders (Last 7 days)</b></td><td>" + newOrders + "</td></tr>" +
             "<tr><td><b>Total Revenue</b></td><td>" + totalRevenue + "</td></tr>" +
             "<tr><td><b>Currently Pending Orders</b></td><td>" + pendingOrders + "</td></tr>" +
             "</table>";

sendmail
[
    from: zoho.adminuserid
    to: "management@company.com"
    subject: "Weekly Operations Report — Week of " + weekStart.toString("dd-MMM-yyyy")
    message: reportBody
]
```

### Example 3: Monthly Data Archival

```deluge
// Schedule: Archive_Old_Records | Frequency: Monthly on 1st at 02:00
// Purpose: Move records older than 1 year to archive form

cutoffDate = zoho.currentdate.subYear(1);

for each rec in Completed_Requests [Completion_Date < cutoffDate && Archived == false]
{
    // Create archive record
    insert into Archived_Requests
    [
        Original_ID = rec.ID
        Request_Number = rec.Request_Number
        Customer = rec.Customer
        Description = rec.Description
        Completion_Date = rec.Completion_Date
        Archived_On = zoho.currentdate
    ]

    // Mark original as archived
    rec.Archived = true;
}

// Send summary
archivedCount = Archived_Requests[Archived_On == zoho.currentdate].count();
sendmail
[
    from: zoho.adminuserid
    to: zoho.adminuserid
    subject: "Monthly Archive Complete — " + archivedCount + " records archived"
    message: "Archive job completed on " + zoho.currentdate.toString("dd-MMM-yyyy") +
             ". Total records archived this run: " + archivedCount
]
```

### Example 4: Daily Stock Reorder Alert

```deluge
// Schedule: Check_Low_Stock | Frequency: Daily at 07:00
// Purpose: Alert purchasing team when stock falls below minimum level

lowStockItems = List();

for each product in Products [Stock_Quantity <= Minimum_Stock && Is_Active == true]
{
    lowStockItems.add(product.Product_Name + " (Current: " + product.Stock_Quantity + ", Min: " + product.Minimum_Stock + ")");
}

if(lowStockItems.size() > 0)
{
    itemList = "<ul>";
    for each item in lowStockItems
    {
        itemList = itemList + "<li>" + item + "</li>";
    }
    itemList = itemList + "</ul>";

    sendmail
    [
        from: zoho.adminuserid
        to: "purchasing@company.com"
        subject: "⚠️ Low Stock Alert — " + lowStockItems.size() + " items need reorder"
        message: "<h3>The following items are below minimum stock levels:</h3>" + itemList
    ]
}
```

---

## Schedule Limits & Best Practices

| Concern | Guideline |
|---|---|
| **Execution time** | Schedules can run long; avoid infinite loops |
| **Record iteration** | Use range/criteria to process in batches; avoid `[ID != 0]` on huge datasets |
| **External API calls** | Each `invokeurl` counts against your external calls quota |
| **Email sending** | Sendmail within loops — each counts against email limits |
| **Error handling** | Schedules fail silently; build in logging (insert error records) |
| **Overlapping runs** | Creator won't start a new run if previous is still running |

---

## When to Use Schedules vs Batch Workflows

| Use Schedule when | Use Batch Workflow when |
|---|---|
| Time-based reporting | Bulk record processing on a form |
| Data cleanup / archival | Apply same logic to many records |
| External API sync (no specific form) | Form-bound, record-iterating operations |
| Sending digest emails | Updating many records in one form |
