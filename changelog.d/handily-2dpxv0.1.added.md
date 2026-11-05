- **A Mermaid git graph draws as lanes.** In reply-view, a `gitGraph` draws top down with one
  lane for each branch, in its cycle colour. A commit draws `●`, a reverse commit `⊗`, a
  highlight commit `▮` and a merge `◉`, with its id, message and tags. A merge and a new branch
  draw as joins between lanes. A cherry-pick names the commit that it copies. A label that does
  not fit wraps under its lanes. `gitGraph BT:` and a graph that Mermaid refuses draw as their
  source under a note that names the reason. (handily-2dpxv0.1)
