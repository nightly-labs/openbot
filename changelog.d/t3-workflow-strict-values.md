### Changed

- Workflow answers are stricter. `int` and `integer` fields now take whole numbers only. A number field takes a JSON number or decimal text, not `0x10` or other forms. A list field needs a list, not one text. A model or agent reply with no JSON object, or with a field name in the wrong case or a field that the step does not ask for, gets one more try with the problem. A webhook body with a field name in the wrong case is refused.
- A list value in an agent task or a model prompt now comes as a JSON list. An approval question shows answer values as plain text, not in JSON quotes.

### Fixed

- In a condition check, an apostrophe inside a word such as `it's` no longer hides the `and` or `or` tests after it.
