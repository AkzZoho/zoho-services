# Zoho Creator — Batch Workflows

> **Batch Workflows** process **multiple records from a specific form** in bulk.
> They run on a schedule or on-demand and iterate over records matching a criteria.
>
> Unlike Schedules (which run free-form Deluge), Batch Workflows are:
> - **Form-bound** — tied to a specific form
> - **Record-iterating** — automatically loop through records
> - **Platform-managed** — Creator handles batching, parallelism, and error resumption

---

## Batch Workflow vs Schedule vs Form Workflow

| Feature | Batch Workflow | Schedule | Form Workflow |
|---|---|---|---|
| Trigger | Scheduled or on-demand | Time-based | Form record event |
| Scope | All matching records in a form | Free-form Deluge | One record at a time |
| Iteration | Auto | Manual (`for each`) | Implicit (current record) |
| Record access | `input.*` per record | Query each yourself | `input.*` |
| Error handling | Per-record, continues on error | Script-level | Per-execution |
| Best for | Bulk updates, mass emails, bulk status changes | Reporting, external sync | Single-record automation |

---

## Batch Workflow Configuration

| Setting | Options |
|---|---|
| **Name** | Identifier |
| **Form** | Which form's records to process |
| **Criteria** | Which records to include (e.g. `Status == "Pending"`) |
| **Run** | On a Schedule / On demand (button trigger) |
| **Action** | Deluge script executed per record |

Inside the Deluge script, `input.*` refers to **each individual record** being processed.

---

## Complete Batch Workflow Examples

### Example 1: Bulk Status Update — Mark overdue tasks as "Overdue"

```deluge
// Batch Workflow: Mark_Overdue_Tasks
// Form: Tasks
// Criteria: Status == "Pending" && Due_Date < zoho.currentdate
// Schedule: Daily at 07:00
// Purpose: Auto-update all pending tasks past their due date to "Overdue"

// input.* = current Task record being processed
if(input.Status == "Pending" && input.Due_Date < zoho.currentdate)
{
    input.Status = "Overdue";
    input.Overdue_Since = zoho.currentdate;

    // Notify the assigned user
    sendmail
    [
        from: zoho.adminuserid
        to: input.Assigned_To_Email
        subject: "⚠️ Task Overdue: " + input.Task_Name
        message: "<p>The task <b>" + input.Task_Name + "</b> assigned to you was due on " +
                 input.Due_Date.toString("dd-MMM-yyyy") + " and is now overdue.</p>" +
                 "<p>Please update the status or contact your manager.</p>"
    ]
}
```

### Example 2: Mass Email Campaign — Notify active customers of a promotion

```deluge
// Batch Workflow: Send_Promotion_Email
// Form: Customers
// Criteria: Status == "Active" && Email_Opt_In == true
// Run: On demand (triggered manually by admin)
// Purpose: Send promotional email to all eligible customers

// input.* = current Customer record
sendmail
[
    from: zoho.adminuserid
    to: input.Email
    subject: "🎉 Special Offer — Exclusive for Valued Customers"
    message: "<p>Dear " + input.First_Name + ",</p>" +
             "<p>As one of our valued customers, we are pleased to offer you an exclusive <b>20% discount</b> " +
             "on all orders this month.</p>" +
             "<p>Use code: <b>VALUED20</b> at checkout.</p>" +
             "<p>Valid until: 31-Dec-2025</p>" +
             "<p>Thank you for your continued business!</p>"
]

// Log the email sent
insert into Email_Log
[
    Customer = input.ID
    Email_Type = "Promotion"
    Sent_On = zoho.currenttime
    Status = "Sent"
]
```

### Example 3: Bulk Recalculation — Recompute outstanding balance

```deluge
// Batch Workflow: Recalculate_Outstanding_Balances
// Form: Customer_Accounts
// Criteria: Account_Status == "Active"
// Schedule: Monthly on 1st at 01:00
// Purpose: Recompute each customer's outstanding balance from their invoices

customerId = input.ID;

// Sum all unpaid invoices for this customer
totalInvoiced = Invoices[Customer == customerId && Status != "Paid"].Invoice_Amount.sum();
totalPaid = Payments[Customer == customerId].Payment_Amount.sum();
outstanding = totalInvoiced - totalPaid;

// Update the customer account
input.Total_Invoiced = totalInvoiced;
input.Total_Paid = totalPaid;
input.Outstanding_Balance = outstanding;
input.Last_Reconciled = zoho.currentdate;

// Flag overdue accounts
if(outstanding > 0)
{
    oldestUnpaid = Invoices[Customer == customerId && Status == "Unpaid"].Due_Date.min();
    if(oldestUnpaid < zoho.currentdate.subDay(30))
    {
        input.Account_Flag = "Overdue";
    }
}
else
{
    input.Account_Flag = "Clear";
}
```

### Example 4: Bulk Record Creation — Generate monthly maintenance tickets

```deluge
// Batch Workflow: Generate_Monthly_Maintenance_Tickets
// Form: Equipment
// Criteria: Maintenance_Required == true && Is_Active == true
// Schedule: Monthly on 1st at 06:00
// Purpose: Create a maintenance ticket for each piece of active equipment

// Check if a ticket already exists for this month
thisMonth = zoho.currentdate.getMonth();
thisYear = zoho.currentdate.getYear();

existingTicket = Maintenance_Tickets
[
    Equipment == input.ID &&
    Added_Time.getMonth() == thisMonth &&
    Added_Time.getYear() == thisYear
];

if(existingTicket.count() == 0)
{
    // Create the maintenance ticket
    newTicketId = insert into Maintenance_Tickets
    [
        Equipment = input.ID
        Equipment_Name = input.Equipment_Name
        Equipment_Code = input.Equipment_Code
        Scheduled_Date = zoho.currentdate.addDay(7)
        Status = "Scheduled"
        Maintenance_Type = input.Default_Maintenance_Type
        Assigned_Team = input.Maintenance_Team
        Priority = input.Maintenance_Priority
    ]

    // Notify the maintenance team
    sendmail
    [
        from: zoho.adminuserid
        to: input.Maintenance_Team_Email
        subject: "Maintenance Scheduled: " + input.Equipment_Name + " — " + zoho.currentdate.toString("MMM yyyy")
        message: "A monthly maintenance ticket has been created for <b>" + input.Equipment_Name +
                 "</b> (" + input.Equipment_Code + ").<br>" +
                 "Scheduled for: " + zoho.currentdate.addDay(7).toString("dd-MMM-yyyy")
    ]
}
```

---

## Batch Workflow Best Practices

| Concern | Guideline |
|---|---|
| **Criteria** | Always add criteria — avoid processing ALL records unless truly needed |
| **Idempotency** | Script should be safe to run twice (check before creating, use flags) |
| **Error isolation** | An error in one record doesn't stop others (Creator handles this) |
| **Email limits** | Sending one email per record × 10,000 records can hit quotas fast |
| **External calls** | Each `invokeurl` per record = many API calls; watch quota |
| **Field updates** | `input.Field = value` directly updates the record; no insert needed |
| **Logging** | Insert an audit record per batch run for traceability |

---

## When to Use Batch Workflows

| Use Case | Batch Workflow |
|---|---|
| Update status of expired records daily | ✅ |
| Send monthly email to 500 customers | ✅ |
| Recalculate totals on 1,000 accounts | ✅ |
| Generate monthly tickets for all active assets | ✅ |
| Send a one-off report email | ❌ (use Schedule) |
| React to a single form submission | ❌ (use Workflow) |
| Complex multi-step approval | ❌ (use Blueprint) |
