# Showcase Data

This folder contains a tiny fake SuccessFactors-style dataset for demoing SuccessFactors Instance Explorer without client data.

## Import Order

Create a new project in the app, then upload these files into the matching Import dropzones:

| Import section | File |
| --- | --- |
| Object Definitions | `object-definitions.zip` |
| Roles and Permissions | `rbp/showcase-manager-role.json` |
| OData Metadata XML | `odata/showcase-odata-metadata.xml` |
| Data Model (CDM + CSF) | `data-model/showcase-cdm.xml` and `data-model/showcase-csf-usa.xml` |
| Succession Data Model | `succession/showcase-succession-data-model.xml` |
| Workflow configuration CSV | `workflow/WFInfo.csv` |
| Business Rules Export | `business-rules/Rule.csv` |
| Business Rules Assignments | `business-rules/businessrulesassignments.csv` |

## What It Demonstrates

- Two fake MDF objects: Showcase Request and Showcase Department.
- One association from request to department.
- One business rule bound to the request object.
- One RBP role with field permissions for the request object.
- One OData entity set exposed for the request object.
- One workflow with one approval step.
- One rule assignment row linked to the business rule.

All names, roles, workflows, and rules are synthetic.
