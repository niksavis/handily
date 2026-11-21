- **A long reply no longer draws raw markdown first.** Text that streams longer than 8 seconds
  now draws one whole markdown block at a time: a paragraph or a list at its blank line, a table
  at its end, a code block or a diagram at its closing fence. Before, it streamed raw and changed
  to the formatted view at the end. A block that stays open past 6,000 characters streams as it
  comes. (handily-j2wg8z)
