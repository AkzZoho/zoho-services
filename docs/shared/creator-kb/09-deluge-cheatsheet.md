# Zoho Deluge — Complete Cheatsheet

> Official source: https://www.zoho.com/deluge/help/
> Applicable to Zoho Creator. All syntax verified against official documentation.

---

## 1. Variables & Data Types

```deluge
// Variables are dynamically typed — no declaration needed
name = "John";
count = 42;
amount = 99.99;
isActive = true;
today = zoho.currentdate;
now = zoho.currenttime;

// Collections
myList = List();
myMap = Map();
myCollection = Collection();
```

### Data Types

| Deluge Type | Creator Field Types |
|---|---|
| TEXT | Single Line, Multi Line, Email, Phone, URL, Dropdown, Radio, Rich Text |
| NUMBER | Number, Auto Number, Lookup ID |
| DECIMAL | Decimal, Currency, Percent |
| BOOLEAN | Decision Box |
| DATE-TIME | Date, Date-Time, Time |
| LIST | Multi-Select, CheckBox, Multi-Select Lookup |
| KEY-VALUE | Map (key-value pairs) |
| FILE | File Upload, Image, Audio, Video |
| COLLECTION | Record sets, Subform rows |

---

## 2. System Variables (Zoho Variables)

```deluge
zoho.currentdate      // Today's date (DATE type)
zoho.currenttime      // Current date + time (DATETIME type)
zoho.loginuser        // Username of the logged-in user (TEXT)
zoho.loginuserid      // Email of the logged-in user (TEXT)
zoho.adminuser        // App owner username (TEXT)
zoho.adminuserid      // App owner email (TEXT)
zoho.appname          // App link name (TEXT)
zoho.appuri           // App URI path (TEXT)
zoho.ipaddress        // User's IP address (TEXT)
zoho.device.type      // "web" | "phone" | "tablet" (TEXT)
```

---

## 3. Operators

```deluge
// Arithmetic
a + b    // addition (also string concat)
a - b    // subtraction
a * b    // multiplication
a / b    // division
a % b    // modulo

// Comparison
a == b   // equal
a != b   // not equal
a > b    // greater than
a < b    // less than
a >= b   // greater than or equal
a <= b   // less than or equal

// Logical
a && b   // AND
a || b   // OR
!a       // NOT

// String concat
fullName = firstName + " " + lastName;
```

---

## 4. Control Flow

### if / else if / else

```deluge
if(condition1)
{
    // block
}
else if(condition2)
{
    // block
}
else
{
    // block
}
```

### for each (iterate a list)

```deluge
items = {"Apple", "Banana", "Cherry"};
for each item in items
{
    info item;
}
```

### for each record (iterate form records)

```deluge
// Iterate all records matching criteria
for each rec in Form_Name [criteria]
{
    info rec.Field_Name;
}

// Iterate all records (use with caution on large datasets)
for each rec in Form_Name [ID != 0]
{
    info rec.Field_Name;
}

// With sort and range
for each rec in Orders [Status == "Pending"] sort by Added_Time desc range from 1 to 100
{
    info rec.Order_Number;
}
```

### for each (iterate index range)

```deluge
for each index i in 0..10
{
    info i;
}
```

### while

```deluge
i = 0;
while(i < 5)
{
    info i;
    i = i + 1;
}
```

---

## 5. CRUD Operations (Creator-specific)

### Fetch records (query syntax — fastest, native)

```deluge
// Single record
rec = Form_Name[ID == someId];
value = rec.Field_Name;

// Multiple records — returns Collection
recs = Form_Name[Status == "Active"];

// Count
cnt = Form_Name[Status == "Active"].count();

// Get a single field across records as List
emails = Customers[Status == "Active"].Email.getAll();

// Sum, Min, Max, Average
total = Orders[Month == "January"].Amount.sum();
maxVal = Products[ID != 0].Price.max();
```

### Insert a record

```deluge
// Basic insert
insert into Form_Name
[
    Field1 = "value"
    Field2 = 42
    Field3 = zoho.currentdate
    Lookup_Field = lookupRecordId  // NUMBER: the record ID
]

// Capture the new record ID
newId = insert into Form_Name
[
    Name = "Test"
    Status = "Active"
]

info newId;  // e.g. 435913000000490014
```

### Update a record (direct assignment on fetched record)

```deluge
// Fetch and update
rec = Orders[ID == input.Order_ID];
rec.Status = "Shipped";
rec.Shipped_Date = zoho.currentdate;

// Update multiple matching records
for each rec in Orders [Status == "Pending" && Due_Date < zoho.currentdate]
{
    rec.Status = "Overdue";
}
```

### Delete a record

```deluge
// Delete a fetched record
rec = Temp_Records[ID == input.ID];
delete rec;

// Delete multiple (loop)
for each rec in Old_Logs [Added_Time < zoho.currentdate.subYear(1)]
{
    delete rec;
}
```

---

## 6. Subform Operations

### Insert rows into subform (on form load / on user input)

```deluge
row1 = Parent_Form.Subform_Name();
row1.Item = "Laptop";
row1.Quantity = 1;
row1.Unit_Price = 75000;

row2 = Parent_Form.Subform_Name();
row2.Item = "Mouse";
row2.Quantity = 2;
row2.Unit_Price = 500;

rows = Collection();
rows.insert(row1, row2);
input.Subform_Name.insert(rows);
```

### Read subform rows from a fetched record

```deluge
rec = Sales_Orders[ID == input.ID];
lineItems = rec.Line_Items;  // Collection of subform rows

for each item in lineItems
{
    info item.Product_Name;
    info item.Quantity;
    info item.Unit_Price;
}
```

### Insert into form with subform in one operation

```deluge
row1 = Sales_Orders.Line_Items();
row1.Product = 12345;
row1.Quantity = 3;
row1.Unit_Price = 500;

rows = Collection();
rows.insert(row1);

newOrderId = insert into Sales_Orders
[
    Customer = input.Customer_ID
    Order_Date = zoho.currentdate
    Line_Items = rows
]
```

---

## 7. Email — sendmail

```deluge
sendmail
[
    from: zoho.adminuserid               // Must be admin email or verified sender
    to: "customer@example.com"           // Or a variable: rec.Email
    cc: "manager@company.com"            // Optional
    bcc: "archive@company.com"           // Optional
    reply to: "support@company.com"      // Optional
    subject: "Your Order is Confirmed"
    message: "<h3>Hello!</h3><p>Your order has been placed.</p>"  // HTML supported
    // Optional attachments:
    // attachments: file: input.Upload_Field
    // attachments: view: Report_Name [criteria] as PDF
    // attachments: template: Template_Name as PDF
]
```

---

## 8. HTTP Calls — invokeurl

```deluge
// GET request
response = invokeurl
[
    url: "https://api.example.com/data"
    type: GET
    headers: {"Authorization": "Bearer " + apiToken}
    connection: "my_connection_name"  // OAuth connection
]

// POST request with JSON body
payload = Map();
payload.put("name", "John Doe");
payload.put("email", "john@example.com");

response = invokeurl
[
    url: "https://api.example.com/contacts"
    type: POST
    parameters: payload.toString()
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + apiToken}
    connection: "my_connection_name"
]

// Parse response
if(response.get("status") == "success")
{
    id = response.get("id").toString();
}
```

---

## 9. Creator API Tasks (cross-app)

```deluge
// Get records from another Creator app
response = zoho.creator.getRecords(
    "owner_username",        // App owner
    "app_link_name",         // App link name
    "report_link_name",      // Report link name
    "Status == \"Active\"",  // Criteria (escape quotes)
    1,                       // Start index
    200,                     // Limit (max 200)
    "creator_oauth_connection"
)
records = response.get("data");

// Create a record in another Creator app
dataMap = Map();
dataMap.put("Field_Name", "Value");
otherParams = Map();
response = zoho.creator.createRecord(
    "owner_username",
    "app_link_name",
    "form_link_name",
    dataMap,
    otherParams,
    "creator_oauth_connection"
)
```

---

## 10. Notifications

### Push Notification

```deluge
pushNotification
[
    to: "username"
    title: "New Assignment"
    message: "Ticket #1234 assigned to you"
    application: zoho.appname
]
```

### Alert (UI — blocks user)

```deluge
alert "This is an alert message.";  // Modal popup
```

### Info (logs to console — dev only)

```deluge
info "Debug value: " + myVariable;
```

### Cancel Submit (on validate only)

```deluge
// Prevent form submission
cancel submit;
// Usually with an alert
alert "Please fill all required fields.";
cancel submit;
```

---

## 11. Navigation

```deluge
// Navigate to a report
openUrl("#Report:Report_Link_Name", "same window");

// Navigate to a page
openUrl("#Page:Page_Name", "same window");

// Navigate to a form
openUrl("#Form:Form_Link_Name", "same window");

// Reload current page
openUrl("#Script:page.reload", "same window");

// Open external URL in new tab
openUrl("https://www.example.com", "new window");
```

---

## 12. List Functions

```deluge
myList = List();
myList.add("item1");
myList.add("item2");

myList.size()           // Count of items
myList.get(0)           // Get item at index 0
myList.contains("item1") // true/false
myList.remove("item1")  // Remove item
myList.clear()          // Empty the list

// Iterate
for each item in myList
{
    info item;
}

// Convert to string (comma-separated)
str = myList.toString(",");
```

---

## 13. Map (KEY-VALUE) Functions

```deluge
myMap = Map();
myMap.put("key1", "value1");
myMap.put("key2", 42);

myMap.get("key1")       // "value1"
myMap.containsKey("key1") // true/false
myMap.keys()            // List of all keys
myMap.values()          // List of all values
myMap.remove("key1")    // Remove key
myMap.size()            // Number of entries
myMap.toString()        // Serialize to JSON string
```

---

## 14. String Functions

```deluge
str = "Hello, World!";

str.length()                     // 13
str.toLowerCase()                // "hello, world!"
str.toUpperCase()                // "HELLO, WORLD!"
str.trim()                       // Remove leading/trailing spaces
str.contains("World")            // true
str.startsWith("Hello")          // true
str.endsWith("!")                // true
str.replaceAll("World", "Zoho")  // "Hello, Zoho!"
str.split(",")                   // List: ["Hello", " World!"]
str.subString(0, 5)              // "Hello"
str.indexOf("World")             // 7
str.matches("[A-Za-z]+")         // Regex match — true/false
str.toNumber()                   // Convert "42" → 42
str.toDecimal()                  // Convert "3.14" → 3.14
str.toBoolean()                  // "true" → true
```

---

## 15. Date/Time Functions

```deluge
d = zoho.currentdate;

d.toString("dd-MMM-yyyy")        // "24-Apr-2025"
d.toString("yyyy-MM-dd")         // "2025-04-24"
d.getDay()                       // Day of month (1-31)
d.getMonth()                     // Month (1-12)
d.getYear()                      // Year (e.g. 2025)
d.getDayOfWeek()                 // "Monday", "Tuesday", etc.

d.addDay(5)                      // 5 days later
d.subDay(3)                      // 3 days earlier
d.addMonth(1)                    // 1 month later
d.subMonth(2)                    // 2 months earlier
d.addYear(1)                     // 1 year later
d.subYear(1)                     // 1 year earlier

// Difference
diff = d1.daysBetween(d2)        // Number of days between d1 and d2
```

---

## 16. Number Functions

```deluge
num = 42;

num.toString()       // "42"
num.toDecimal()      // 42.0
num.abs()            // Absolute value
num.round(2)         // Round to 2 decimal places
num.ceil()           // Round up
num.floor()          // Round down

// Math
pow(2, 10)           // 2^10 = 1024
sqrt(16)             // 4.0
```

---

## 17. Collection Functions (Record sets)

```deluge
recs = Form_Name[Status == "Active"];

recs.count()         // Number of records
recs.ID.getAll()     // List of all IDs
recs.Email.getAll()  // List of all email values
recs.Amount.sum()    // Sum of Amount field
recs.Amount.max()    // Maximum value
recs.Amount.min()    // Minimum value
recs.Amount.average() // Average value
```

---

## 18. Error Handling Pattern (no try/catch — use conditional)

```deluge
// Creator Deluge doesn't have try/catch.
// Best practice: validate before acting, log errors to a form.

if(input.Email == null || input.Email == "")
{
    insert into Error_Log
    [
        Error_Source = "Contact_Form"
        Error_Message = "Email is required but was empty"
        Error_Time = zoho.currenttime
        User = zoho.loginuser
    ]
    alert "Email is required.";
    cancel submit;
}

// For API call errors, check response code
response = invokeurl [url: apiUrl type: GET connection: "my_conn"]

if(response.get("error") != null)
{
    insert into Error_Log
    [
        Error_Source = "API Call"
        Error_Message = response.get("error").toString()
        Error_Time = zoho.currenttime
    ]
}
```

---

## 19. Quick Reference — Field Access

| Context | Syntax | Meaning |
|---|---|---|
| Form being submitted | `input.Field_Name` | Value user entered |
| Fetched single record | `rec.Field_Name` | Field value from fetched record |
| Lookup field value | `input.Lookup_Field.Related_Field` | Field from the looked-up record |
| All values of a field | `Form[criteria].Field.getAll()` | Returns a List |
| Count of records | `Form[criteria].count()` | Returns NUMBER |
| Sum of numeric field | `Form[criteria].Field.sum()` | Returns DECIMAL |

---

## 20. Deluge in Blueprint vs Workflow vs Schedule

| Context | `input.*` available? | Can cancel? | User context |
|---|---|---|---|
| Workflow `on load` | Yes (form fields) | No | Logged-in user |
| Workflow `on validate` | Yes (submitted values) | Yes (`cancel submit`) | Logged-in user |
| Workflow `on success` | Yes (saved values) | No | Logged-in user |
| Workflow `on user input` | Yes (field changed) | No | Logged-in user |
| Blueprint `before transition` | Yes (record being transitioned) | Yes | Transition performer |
| Blueprint `after transition` | Yes (record post-transition) | No | Transition performer |
| Schedule | No (`input.*` not available) | No | App owner (admin) |
| Batch Workflow | Yes (current record being processed) | No | App owner (admin) |
| Custom Function | Depends on caller context | Depends | Caller's context |
