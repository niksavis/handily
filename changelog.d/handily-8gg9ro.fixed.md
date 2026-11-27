- **The command lines of a `do` task show the characters that `copy` puts on the
  clipboard, and only an open task shows them.** The board drew each line escaped like a task
  title, so a backslash showed twice, and `C:\Users\me\x.ps1` read as `C:\\Users\\me\\x.ps1`.
  Now each line shows as it copies. Only a control character shows as its code, such as
  `\u001b`, so that an escape sequence cannot change the terminal. A closed or withdrawn task
  no longer draws the lines and the `copy` buttons when you open it. A new test covers a copy
  that fails with an error: the toast `Not copied` shows. (handily-8gg9ro)
