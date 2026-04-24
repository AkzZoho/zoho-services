# Deluge Language Reference (for the code-description engine)

> Source: <https://www.zoho.com/deluge/resources.html> (Knowledge Base –
> Basic / Intermediate / Advanced), plus observations made against our
> own `samples/*.ds` corpus.
>
> **Purpose of this file:** it is the canonical cheat-sheet used by the
> `describeCodeBlock()` pipeline in `client/src/components/AppOverview.jsx`
> to convert raw Deluge snippets into plain-English bullet points inside
> the "What this does" popup panel. Keep the statement → description
> mapping here in sync with the regex list in
> `STATEMENT_PATTERNS`.

---

## 1. Workflow container

Every workflow in a `.ds` file is wrapped in a `form … { }` block (even
non-form scoped ones — it's just the container syntax):

```deluge
form <Name> as "<Display>" {
    type = form
    form = <TargetForm>
    record event = <on add | on edit | on add or edit | …>

    <trigger-block> {
        actions {
            custom deluge script ( <STATEMENTS> )
        }
    }
}
```

Trigger blocks we see in the wild:

| Trigger block         | When it fires                                                    |
| --------------------- | ---------------------------------------------------------------- |
| `on load`             | Form opens (before the user sees it)                             |
| `on validate`         | User submits, before save                                        |
| `on success`          | After the record is saved                                        |
| `on user input of X`  | User changes field `X`                                           |
| `field rules`         | Declarative show/hide/disable rules (not Deluge)                 |
| `schedule`            | Scheduled workflow — runs without a user                         |
| `button / function`   | Button-attached custom function (`scope = functions`)            |

---

## 2. Top-level statements (what we describe)

The description engine walks the custom-deluge-script body and emits one
bullet per statement it recognises. Statements it does **not** recognise
are skipped silently (so multi-line expressions don't produce noise).

### 2.1 Record queries — `Form[criteria]`

```deluge
email   = Student[ID in input.Student].Primary_Contact_Email.getAll();
vacancy = Class[ID == input.Class].Vacancy;
leads   = Lead[ID != 0];
```

Description template:

> Fetches **`<field>`** from the **`<Form>`** form where `<criteria>`.

If the expression ends in `.count()` → "counts how many records match".
If it ends in `.getAll()` → "collects all matching values as a list".

### 2.2 Record mutation — direct field assignment

```deluge
lead.Status = "Registered";
examMarks.Total_Marks_Scored = examMarks.Total_Marks_Scored + input.Marks_Secured - oldMark;
```

Description template:

> Updates **`<Form>.<Field>`** to `<value>`.

(If `<Form>` is a previously-queried variable — common — we describe it
as "updates the fetched record's `<field>`".)

### 2.3 `insert into <Form>[ ... ]` — create a record

```deluge
resp = insert into Lead_History
[
    Added_User = zoho.loginuser
    Lead       = input.Lead
    Field_field = "Status"
    Changes    = "Status changed …"
];
```

Description template:

> Creates a new **`<Form>`** record with `<N>` field(s) populated.

### 2.4 `sendmail [ … ]` — transactional email

```deluge
sendmail
[
    from    : zoho.loginuserid
    to      : email
    subject : input.Subject_field
    message : input.Message
]
```

Description template:

> Sends an email to **`<to>`** with subject **"<subject>"**.

### 2.5 `invokeurl [ url: … type: … ]` — HTTP call

```deluge
invokeurl
[
    url : "https://api.example.com/x"
    type : POST
    parameters : payload
]
```

Description template:

> Calls the external API **`<url>`** (`<METHOD>`).

### 2.6 `openUrl("#Page:X", "same window")` / `openUrl("#Report:Y", …)`

Description template:

> Navigates the user to the **`<X>`** page / report.

Special case `openUrl("#Script:page.reload", …)` → "Reloads the current
page."

### 2.7 `alert "…"` / `info "…"` — pop a message

Description template:

> Shows an alert: **"<text>"**.
> Shows an info message: **"<text>"**.

### 2.8 Field UI mutations — `show`, `hide`, `disable`, `enable`

```deluge
show Vacancy_after_adding_the_student;
hide Transport_Type;
disable Final_Fee, Parents, Total_Fee;
```

Description template:

> Shows / hides / disables **`<Field1>, <Field2>, …`**.

### 2.9 `for each <v> in <list> { … }`

Description template:

> Loops over each **`<list>`** entry as `<v>`.

### 2.10 `if ( cond ) { … } else if … else { … }`

Description template:

> If **`<condition>`**, …; otherwise …

We unwrap the outer `if` only — nested logic gets `(with additional
conditional branches)`.

### 2.11 Sub-function call — `thisapp.<namespace>.<fn>(args)`

```deluge
thisapp.SDP.Add_Incident(input.ID);
```

Description template:

> Calls the custom function **`<namespace>.<fn>`** with `<N>` argument(s).

### 2.12 `input.<Field> = …` — update the form being submitted

Description template:

> Sets the submitted form's **`<Field>`** to `<value>`.

---

## 3. Expressions we normalise

| Raw                          | Shown as                         |
| ---------------------------- | -------------------------------- |
| `zoho.loginuserid`           | the logged-in user's email       |
| `zoho.loginuser`             | the logged-in user               |
| `zoho.currentdate`           | today's date                     |
| `input.<Field>`              | the submitted `<Field>`          |
| `<var>.count() == 0`         | "no records match"               |
| `<x> == null` / `!= null`    | "is empty" / "is filled in"      |

---

## 4. Things we deliberately skip

- Lines starting with `//` (comments) — these are often larger than the
  actual logic in the sample apps, so they'd dominate the description.
- Empty statements, stray `;`.
- Variable assignments whose right-hand side is another variable we've
  already described (keeps bullet count low).

---

## 5. Output shape

The generator returns:

```ts
{
  trigger: string,        // "Runs when a new record is added to Fee_Receipt."
  actions: string[],      // one bullet per recognised statement
  notes:   string[],      // soft hints (e.g. "body is ~400 lines")
}
```

`WorkflowDescription` renders `trigger` as an intro paragraph, `actions`
as a numbered list, and `notes` as muted italic text below.
