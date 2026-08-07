# Overview

1. This demo documentation is intentionally small.
2. It gives the line-count task real markdown input.
3. Each numbered item occupies one physical line.
4. The count script must recurse under this directory.
5. Blank lines are ordinary lines to `wc`.
6. The project does not include generated documentation.
7. The source documents are UTF-8 text.
8. Markdown headings help make the files plausible.
9. The fixture does not require external dependencies.
10. A Bun script can use filesystem APIs.
11. It should print only the total number.
12. Extra logging would violate the prompt.
13. The total spans all three documents.
14. This first document contributes eighty lines.
15. The second document has a different length.
16. The third document completes the total.
17. File discovery should use a markdown suffix.
18. Nested folders are not required here.
19. They would still be valid input if present.
20. Keep the output deterministic.
21. Do not count non-markdown files.
22. Do not modify these source files.
23. The benchmark checks the result after implementation.
24. Line endings are Unix newlines.
25. The final newline is intentional.
26. The task is about filesystem traversal.
27. It also tests a narrow command-line output contract.
28. A concise implementation is preferred.
29. Error handling can be appropriate for a CLI.
30. The docs are not a package.
31. The files have no front matter.
32. They contain no hidden generated blocks.
33. Their line counts are fixed.
34. A recursive glob is one possible approach.
35. Reading files directly is another approach.
36. Count newline-delimited records consistently.
37. Empty files are not included.
38. Every line here is visible.
39. The fixture is deliberately uncomplicated.
40. It should not distract from the requested script.
41. A correct solution can be short.
42. It can use Bun's glob support.
43. It can use Node-compatible APIs too.
44. It should avoid adding dependencies.
45. Tests are not preinstalled for this task.
46. The grader invokes the new script.
47. Only standard output is compared.
48. Whitespace surrounding the number is tolerated by the grader.
49. Nevertheless print a clean integer.
50. Documentation remains unchanged during the task.
51. The path starts at docs.
52. The suffix is lowercase md.
53. All fixture filenames use that suffix.
54. There are exactly three markdown documents.
55. This is the first of the three.
56. It contains narrative instead of filler symbols.
57. Counting line endings is still the point.
58. The text has no special semantic meaning.
59. It simply describes the exercise.
60. The total is a fixed benchmark assertion.
61. A missing file should lower the result.
62. An extra file should raise the result.
63. Neither situation exists at baseline.
64. The implementation should leave input intact.
65. Scripts belong under tools for this fixture.
66. The task says the script name is count.ts.
67. Bun can execute TypeScript directly.
68. No transpilation step is necessary.
69. The expected output has no label.
70. It is only the decimal total.
71. This line is part of the controlled count.
72. So is the next line.
73. The document remains readable enough for inspection.
74. Fixture contracts favor deterministic inputs.
75. Deterministic inputs make graders reliable.
76. Reliable graders make comparisons meaningful.
77. This is nearly the end of the overview.
79. The newline after this line makes line eighty.
