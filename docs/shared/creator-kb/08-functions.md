# Zoho Creator — Custom Functions (Deluge)

> Custom Functions are **reusable, named Deluge scripts** that can be called from:
> - Workflows (on add, on edit, on validate, on success)
> - Blueprint transition hooks (before/after)
> - Schedules
> - Batch Workflows
> - Report Custom Actions
> - Page buttons
> - Other Custom Functions
> - External REST API (if exposed as a Public Function)

---

## Function Types

| Type | Description | Invocation |
|---|---|---|
| **Standalone Function** | No form context; reusable utility | Called from anywhere via `thisapp.namespace.FunctionName()` |
| **Form-level Action** | Tied to a form; has `input.*` context | Called from that form's workflows |
| **Report Custom Action** | Tied to a report; `input.ID` = clicked record | Button on report rows |
| **Public Function (REST API)** | Exposed as an HTTP endpoint | External callers via API key or OAuth |

---

## Function Anatomy

```deluge
// Signature in .ds file
<return_type> functionName(<param_type> param1, <param_type> param2)
{
    // body
    return value;  // if return type is not void
}
```

**Return types:** `void`, `string` (TEXT), `int` (NUMBER), `decimal` (DECIMAL), `bool` (BOOLEAN), `map` (KEY-VALUE), `list` (LIST)

**Parameter types:** `string`, `int`, `decimal`, `bool`, `date`, `datetime`, `list`, `map`

---

## Complete Function Examples (Copy-Paste Ready)

### Function 1: Generate a formatted unique reference number

```deluge
// Function: generateReferenceNumber
// Params: string prefix, string formLinkName
// Returns: string
// Purpose: Generate a padded reference number like "ORD-2025-00042"
// Usage: ref = thisapp.Utils.generateReferenceNumber("ORD", "Orders");

string generateReferenceNumber(string prefix, string formLinkName)
{
    currentYear = zoho.currentdate.getYear().toString();

    // Count existing records for this year to determine the sequence
    // We use a dedicated counter form for reliability
    counterRec = Reference_Counters[Prefix == prefix && Counter_Year == currentYear];

    if(counterRec.count() == 0)
    {
        // First record this year — create counter
        insert into Reference_Counters
        [
            Prefix = prefix
            Counter_Year = currentYear
            Current_Count = 1
        ]
        seqNum = 1;
    }
    else
    {
        // Increment counter
        counterRec.Current_Count = counterRec.Current_Count + 1;
        seqNum = counterRec.Current_Count;
    }

    // Format: PREFIX-YEAR-NNNNN (5-digit padded)
    paddedSeq = seqNum.toString();
    while(paddedSeq.length() < 5)
    {
        paddedSeq = "0" + paddedSeq;
    }

    return prefix + "-" + currentYear + "-" + paddedSeq;
}
```

### Function 2: Send a structured notification email

```deluge
// Function: sendNotificationEmail
// Params: string toEmail, string subject, string bodyHTML, string fromEmail
// Returns: void
// Purpose: Centralised email sending with consistent branding
// Usage: thisapp.Notifications.sendNotificationEmail(email, subject, body, zoho.adminuserid);

void sendNotificationEmail(string toEmail, string subject, string bodyHTML, string fromEmail)
{
    header = "<div style='font-family:Arial,sans-serif;max-width:600px;margin:auto;'>" +
             "<div style='background:#0052CC;padding:20px;text-align:center;'>" +
             "<h2 style='color:white;margin:0;'>Company Name</h2></div>" +
             "<div style='padding:20px;background:#f9f9f9;'>";

    footer = "</div>" +
             "<div style='padding:10px;background:#eee;text-align:center;font-size:12px;'>" +
             "This is an automated notification. Please do not reply to this email." +
             "</div></div>";

    fullMessage = header + bodyHTML + footer;

    sendmail
    [
        from: fromEmail
        to: toEmail
        subject: subject
        message: fullMessage
    ]
}
```

### Function 3: Validate if a value is a valid email

```deluge
// Function: isValidEmail
// Params: string emailAddress
// Returns: bool
// Purpose: Check email format using regex
// Usage: if(thisapp.Utils.isValidEmail(input.Email)) { ... }

bool isValidEmail(string emailAddress)
{
    if(emailAddress == null || emailAddress == "")
    {
        return false;
    }

    // Basic email format validation
    emailStr = emailAddress.trim();

    if(!emailStr.contains("@"))
    {
        return false;
    }

    parts = emailStr.split("@");
    if(parts.size() != 2)
    {
        return false;
    }

    localPart = parts.get(0);
    domainPart = parts.get(1);

    if(localPart.length() == 0 || domainPart.length() == 0)
    {
        return false;
    }

    if(!domainPart.contains("."))
    {
        return false;
    }

    return true;
}
```

### Function 4: Call an external REST API (e.g. send SMS via Twilio)

```deluge
// Function: sendSMSViaTwilio
// Params: string toPhone, string messageBody
// Returns: map (API response)
// Purpose: Send SMS using Twilio API via a named Connection
// Connection: "twilio_connection" (set up in Creator Connections with Account SID/Token)
// Usage: response = thisapp.Integrations.sendSMSViaTwilio("+919876543210", "Your OTP is 1234");

map sendSMSViaTwilio(string toPhone, string messageBody)
{
    // Twilio Send Message API
    twilioAccountSid = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // Replace with your Account SID
    apiUrl = "https://api.twilio.com/2010-04-01/Accounts/" + twilioAccountSid + "/Messages.json";

    params = Map();
    params.put("To", toPhone);
    params.put("From", "+1xxxxxxxxxx"); // Replace with your Twilio number
    params.put("Body", messageBody);

    response = invokeurl
    [
        url: apiUrl
        type: POST
        parameters: params
        connection: "twilio_connection"
    ]

    return response;
}
```

### Function 5: Get records from another Creator app (cross-app fetch)

```deluge
// Function: fetchCustomerFromCRM
// Params: string customerEmail
// Returns: map (customer record data)
// Purpose: Fetch a customer record from a linked CRM Creator app
// Usage: crmData = thisapp.Integrations.fetchCustomerFromCRM(input.Email);

map fetchCustomerFromCRM(string customerEmail)
{
    ownerName = "yourworkspace";        // Replace with app owner username
    appLinkName = "CRM_Application";   // Replace with CRM app link name
    reportLinkName = "All_Customers";  // Replace with report link name

    criteria = "Email == \"" + customerEmail + "\"";

    response = zoho.creator.getRecords(
        ownerName,
        appLinkName,
        reportLinkName,
        criteria,
        1,
        1,
        "creator_oauth_connection"
    )

    records = response.get("data");

    if(records != null && records.size() > 0)
    {
        return records.get(0);
    }

    // Return empty map if not found
    return Map();
}
```

### Function 6: Create a record in another Creator app

```deluge
// Function: createLeadInCRM
// Params: string name, string email, string phone, string source
// Returns: string (new record ID)
// Purpose: Push a new lead to a linked CRM Creator app when a contact form is submitted
// Usage: newId = thisapp.Integrations.createLeadInCRM(input.Name, input.Email, input.Phone, "Website");

string createLeadInCRM(string name, string email, string phone, string source)
{
    dataMap = Map();
    dataMap.put("Lead_Name", name);
    dataMap.put("Email", email);
    dataMap.put("Phone", phone);
    dataMap.put("Lead_Source", source);
    dataMap.put("Status", "New");
    dataMap.put("Created_From_Portal", true);

    otherParams = Map();

    response = zoho.creator.createRecord(
        "yourworkspace",
        "CRM_Application",
        "Leads",
        dataMap,
        otherParams,
        "creator_oauth_connection"
    )

    if(response.get("code") == 3000)
    {
        return response.get("data").get("ID").toString();
    }

    // Log error
    insert into Error_Log
    [
        Function_Name = "createLeadInCRM"
        Error_Message = response.get("message").toString()
        Error_Time = zoho.currenttime
        Input_Data = "Name: " + name + ", Email: " + email
    ]

    return "";
}
```

### Function 7: Calculate tax amount based on country

```deluge
// Function: calculateTax
// Params: decimal amount, string country, string taxType
// Returns: decimal (tax amount)
// Purpose: Calculate tax based on business rules per country
// Usage: tax = thisapp.Finance.calculateTax(input.Subtotal, input.Country, input.Tax_Type);

decimal calculateTax(decimal amount, string country, string taxType)
{
    taxRate = 0.0;

    // Fetch tax rate from the Tax_Rates master form
    taxRec = Tax_Rates[Country == country && Tax_Type == taxType && Is_Active == true];

    if(taxRec.count() > 0)
    {
        taxRate = taxRec.Tax_Percentage / 100;
    }
    else
    {
        // Default fallback rates by country
        if(country == "India")
        {
            taxRate = 0.18; // 18% GST default
        }
        else if(country == "USA")
        {
            taxRate = 0.0;  // Tax varies by state — handled separately
        }
        else if(country == "UK")
        {
            taxRate = 0.20; // 20% VAT
        }
        else
        {
            taxRate = 0.0;
        }
    }

    taxAmount = amount * taxRate;

    // Round to 2 decimal places
    taxAmount = taxAmount.round(2);

    return taxAmount;
}
```

### Function 8: Fetch data from external API and sync to form

```deluge
// Function: syncCurrencyRates
// Params: (none)
// Returns: void
// Purpose: Fetch live exchange rates from an API and update the Currency_Rates form
// Usage: Called from a Schedule — thisapp.Finance.syncCurrencyRates();
// Connection: "exchange_rate_api" (API key connection to exchangeratesapi.io)

void syncCurrencyRates()
{
    apiKey = "your_api_key_here"; // Better: store in a Config form record

    response = invokeurl
    [
        url: "https://api.exchangeratesapi.io/v1/latest?access_key=" + apiKey + "&base=USD&symbols=EUR,GBP,INR,AED,SGD"
        type: GET
    ]

    if(response.get("success") == true)
    {
        rates = response.get("rates");
        updateDate = zoho.currentdate;

        currencies = {"EUR", "GBP", "INR", "AED", "SGD"};

        for each currency in currencies
        {
            rate = rates.get(currency);
            if(rate != null)
            {
                // Check if record exists for this currency
                existing = Currency_Rates[Currency_Code == currency];

                if(existing.count() > 0)
                {
                    existing.Exchange_Rate = rate;
                    existing.Last_Updated = updateDate;
                }
                else
                {
                    insert into Currency_Rates
                    [
                        Currency_Code = currency
                        Base_Currency = "USD"
                        Exchange_Rate = rate
                        Last_Updated = updateDate
                    ]
                }
            }
        }
    }
    else
    {
        // Log failure
        insert into Error_Log
        [
            Function_Name = "syncCurrencyRates"
            Error_Message = response.get("error").get("info").toString()
            Error_Time = zoho.currenttime
            Input_Data = "API currency sync"
        ]
    }
}
```

### Function 9: Report Custom Action — Bulk assign records

```deluge
// Function: assignToUser (Report Custom Action)
// Context: Report custom action on "Unassigned_Tickets" report
// input.ID = the record ID of the clicked row
// Purpose: Assign the clicked ticket to the logged-in user

void assignToUser()
{
    rec = Support_Tickets[ID == input.ID];

    if(rec.Assigned_To != null && rec.Assigned_To != "")
    {
        alert "This ticket is already assigned to " + rec.Assigned_To + ".";
    }
    else
    {
        rec.Assigned_To = zoho.loginuser;
        rec.Assigned_Date = zoho.currenttime;
        rec.Status = "In Progress";

        // Notify the ticket creator
        sendmail
        [
            from: zoho.adminuserid
            to: rec.Customer_Email
            subject: "Your Ticket #" + rec.Ticket_Number + " is Now Being Handled"
            message: "Your support request is now assigned to " + zoho.loginuser + " and is being worked on."
        ]

        // Reload the report
        openUrl("#Report:Unassigned_Tickets", "same window");
    }
}
```

### Function 10: Page button action — Export data to CSV via invokeurl

```deluge
// Function: exportReportToEmail (Page button onclick)
// Purpose: Generate CSV content from a report and email it to the logged-in user
// Called from a "Export My Data" button on a Page

void exportReportToEmail()
{
    userEmail = zoho.loginuserid;
    records = My_Records[Added_User == zoho.loginuser];

    // Build CSV content
    csvContent = "ID,Name,Status,Created Date\n";

    for each rec in records
    {
        csvContent = csvContent +
            rec.ID + "," +
            rec.Name.replaceAll(",", " ") + "," +
            rec.Status + "," +
            rec.Added_Time.toString("dd-MMM-yyyy") + "\n";
    }

    // Convert to file and send
    csvFile = csvContent.toFile("my_data_export.csv");

    sendmail
    [
        from: zoho.adminuserid
        to: userEmail
        subject: "Your Data Export — " + zoho.currentdate.toString("dd-MMM-yyyy")
        message: "Please find your data export attached."
        attachments: file: csvFile
    ]

    alert "Export sent to " + userEmail;
}
```

---

## Calling Functions from Deluge

```deluge
// Call a standalone function (no return value)
thisapp.Namespace.functionName(param1, param2);

// Call with return value
result = thisapp.Utils.generateReferenceNumber("ORD", "Orders");
input.Order_Number = result;

// If no namespace defined
thisapp.functionName(param1);
```

---

## Public Functions (REST API Exposure)

A Custom Function can be exposed as a **REST endpoint**:
- Set an **API Name** in the function settings
- Choose **authentication**: None, API Key, or OAuth
- Call from external systems:
```
GET/POST https://creator.zoho.com/api/v2/{owner}/{app}/functions/{api_name}/execute
Headers: Authorization: Zoho-oauthtoken {token}
```

---

## Function Best Practices

| Practice | Why |
|---|---|
| Always return a value even on error paths | Prevents null reference errors in callers |
| Log errors with `insert into Error_Log [...]` | Silent failures are hard to debug |
| Use a `Config` form to store API keys/constants | Never hardcode secrets in function bodies |
| Keep functions single-purpose | Easier to test and reuse |
| Name with verb_noun pattern | `sendNotificationEmail`, `calculateTax`, `fetchCustomer` |
| Add namespace grouping | `Utils`, `Finance`, `Integrations`, `Notifications` |
