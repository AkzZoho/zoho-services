# Zoho Creator — Pages

> Pages are **custom screens** built using a drag-and-drop Page Builder.
> They are the "homepage" / "dashboard" layer of a Creator app.
> A Page has **no data of its own** — it embeds and visualises data from Forms and Reports.

---

## What a Page Can Contain

| Component | What it does |
|---|---|
| **Panel (KPI)** | Single metric: Count / Sum / Average of a form field, with criteria |
| **Chart** | Bar, Line, Pie, Donut, Area, Funnel charts over form data |
| **Report** | Embeds a full report (list, kanban, calendar, etc.) inside the page |
| **Form** | Embeds a form — user can submit directly from the page |
| **Button** | Clickable button with a Deluge script on click |
| **Text / HTML** | Static rich text, labels, announcements |
| **Image** | Static image or logo |
| **iFrame** | Embed external URL |
| **Divider / Spacer** | Layout aid |

---

## Page Layout

- **Drag-and-drop grid** — rows and columns, resizable
- **Sections** — Pages are grouped under navigation Sections (left sidebar)
- **Themes** — App-level visual theme applies to all pages
- Each page gets its own **tab** in the app navigation

---

## Page Deluge Events

| Event | When | Use case |
|---|---|---|
| **On Load** | When page opens | Fetch data, set initial values, show/hide components |
| **Button onClick** | User clicks a Button component | Run CRUD, navigate, call functions |

```deluge
// Page On Load — fetch a summary value and set it to a text component
total = Orders[Status == "Pending"].count();
Pages.Components.Pending_Count.setText(total.toString());

// Button onClick — navigate to a form to add a new record
openUrl("#Form:New_Order_Form", "same window");
```

---

## Navigation Sections

Pages are organised into **Sections** in the left navigation:

```
App Navigation (left sidebar)
├── Section: Operations
│   ├── Page: Dashboard
│   ├── Page: Order Management
│   └── Report: All Orders
├── Section: Masters
│   ├── Report: Customers
│   └── Report: Products
└── Section: Reports
    ├── Report: Monthly Summary
    └── Report: Kanban Board
```

Sections are configured in **Design → Sections** in the app builder.

---

## Page Permissions

Pages inherit access from the **Profiles** assigned to users:
- If a profile can view the embedded form/report, they can see that component
- Components the user has no access to are hidden automatically
- You can also set **per-section visibility** per profile

---

## When to Create a Page

| BRD Trigger | Page type |
|---|---|
| "Dashboard", "Home screen", "Landing page" | KPI + Charts + Embedded Reports |
| "Management overview" / "Executive view" | Summary panels + Pivot chart |
| "Quick entry form embedded in dashboard" | Embedded Form + KPI counts |
| "Status board" | Kanban report embed |
| "Operations center" | Multiple reports + Buttons |

---

## Best Practices

- Every app should have at least one **Homepage** page (set as the default landing page)
- KPI panels should show **actionable counts** (Pending items, Open tickets, etc.)
- Use **Button** components for frequent actions (New Request, Generate Report, etc.)
- Do NOT put all reports on one page — group logically by function/role
