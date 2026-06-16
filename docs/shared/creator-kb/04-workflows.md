# Zoho Creator — Workflows

> Workflows are **event-driven automation rules** tied to form events.
> There are 3 workflow types in Creator:
> 1. **Form Workflows** — triggered by form record events
> 2. **Approval Workflows** — multi-level human approval chains
> 3. **Blueprint Workflows** — per-stage/per-transition scripts (see `06-blueprints.md`)

---

## 1. Form Workflows

The most common type. A **Form Workflow** runs Deluge (or no-code actions) when a record event fires.

### Trigger Configuration

| Setting | Options |
|---|---|
| **Choose Form** | Any form in the app |
| **Run when record is** | Created / Edited / Created or Edited / Deleted |
| **When to trigger** | On form load / On user input of a field / Always (on submit) |
| **Criteria** | Optional condition — only run if criteria matches |

### Action Types (no-code)

| Action | What it does |
|---|---|
| **Send Email** | Email notification with template, attachments, recipients |
| **Push Notification** | Mobile push to app users |
| **Send SMS** | SMS via configured gateway |
| **Assign a Task** | Creates a task in Creator's task module |
| **Update Fields** | Updates field values on the current or another record |
| **Create Record** | Creates a record in another form |
| **Custom Function** | Runs a Deluge script (most powerful option) |
| **Set Approval** | Triggers an approval workflow |
| **Webhooks** | HTTP POST to an external URL |

### Execution Sections (for Deluge actions)

| Section | When | Can cancel? |
|---|---|---|
| `on load` | Form opens | No |
| `on user input` | User changes a field | No |
| `on validate` | On submit, before save | Yes — `cancel submit` or `alert` |
| `on success` | After record saved | No |

---

## 2. Approval Workflows

**Approval Workflows** route records through a multi-level human approval process.

### Key Concepts

- **Approvers** — specific users, roles, or lookup-field-derived users
- **Levels** — sequential approval stages (Level 1 → Level 2 → ...)
- **Actions on Approve / Reject / Escalate** — no-code or Deluge actions
- **Approval Center** — auto-created screen for approvers to manage pending approvals
- **Notifications** — auto-sent to approvers and requestors at each step

### Approval Workflow Configuration

```
Approval Workflow: "Manager Approval"
├── Choose Form: IT_Asset_Requests
├── Run when: Created
├── Criteria: Request_Urgency == "High"
├── Level 1 Approver
│   ├── Type: Role (Manager)
│   ├── On Approve →
│   │   ├── Update Fields: Status = "Approved"
│   │   └── Custom Function: send_approval_email()
│   └── On Reject →
│       └── Update Fields: Status = "Rejected"
└── Level 2 Approver (optional)
    └── ...
```

### Deluge Inside Approval Workflow

```deluge
// Action added to "On Approve" in approval workflow
// input.* refers to the record being approved

rec = IT_Asset_Inventory[ID == input.Requested_Asset];
rec.Quantity_Available = rec.Quantity_Available - 1;

sendmail
[
    from: zoho.adminuserid
    to: input.Employee_Email
    subject: "Your Asset Request is Approved"
    message: "Dear " + input.Employee_Name + ", your request has been approved."
]
```

---

## Form Workflow — Complete Deluge Example

```deluge
// Form: Order_Form | Event: on success | Trigger: on add
// Purpose: On new order, check inventory and send confirmation

// 1. Fetch the product record
product = Products[ID == input.Product];

// 2. Validate stock
if(product.Stock_Quantity < input.Quantity)
{
    // This is on success — can't cancel, so send alert email to admin
    sendmail
    [
        from: zoho.adminuserid
        to: zoho.adminuserid
        subject: "Insufficient Stock for Order " + input.Order_Number
        message: "Order placed for " + input.Quantity + " units but only " + product.Stock_Quantity + " available."
    ]
}
else
{
    // 3. Deduct stock
    product.Stock_Quantity = product.Stock_Quantity - input.Quantity;

    // 4. Create a shipment record
    insert into Shipments
    [
        Order = input.ID
        Product = input.Product
        Quantity = input.Quantity
        Status = "Pending Dispatch"
        Expected_Date = zoho.currentdate.addDay(5)
    ]

    // 5. Notify customer
    sendmail
    [
        from: zoho.adminuserid
        to: input.Customer_Email
        subject: "Order Confirmed — " + input.Order_Number
        message: "<h3>Thank you for your order!</h3><p>Order <b>" + input.Order_Number + "</b> is confirmed.<br>Expected delivery: " + zoho.currentdate.addDay(5).toString("dd-MMM-yyyy") + "</p>"
    ]
}
```

---

## Form Workflow — On Validate Example

```deluge
// Form: Employee_Form | Event: on validate | Trigger: on add or edit
// Purpose: Prevent duplicate email entries

existing = Employees[Email == input.Email && ID != input.ID];
if(existing.count() > 0)
{
    alert "An employee with this email already exists. Please use a different email.";
    cancel submit;
}
```

---

## Form Workflow — On User Input Example

```deluge
// Form: Order_Form | Field: Product | Event: on user input
// Purpose: Auto-populate unit price when product is selected

if(input.Product != null)
{
    product = Products[ID == input.Product];
    input.Unit_Price = product.Price;
    input.Total_Amount = input.Quantity * product.Price;
}
```

---

## Workflow Triggers — Which to Use

| Business Requirement | Workflow Type | Event |
|---|---|---|
| Send email when form submitted | Form Workflow | `on success` / `on add` |
| Validate data before saving | Form Workflow | `on validate` |
| Auto-fill fields on page load | Form Workflow | `on load` |
| Show/hide fields based on selection | Form Workflow | `on user input` |
| Multi-level approval chain | Approval Workflow | — |
| Record lifecycle (stages) | Blueprint | — |
| Bulk record processing | Batch Workflow | — |
| Scheduled automation | Schedule | — |
