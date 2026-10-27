- **reply-view and simple-view show copy toasts in the shared toast layout.** A copy toast
  reads `✓ Copied the plan block` or `✓ Copied the output`, then the line count, such as
  `2 lines`, on its own line, and stays 6 s. A failed copy reads `■ Not copied`, then the
  reason, and stays 10 s. When the copy throws, the reason is `the transcript shows why`, and
  the transcript holds the error. Both mods use the same reason texts (handily-ftx0x.3).
