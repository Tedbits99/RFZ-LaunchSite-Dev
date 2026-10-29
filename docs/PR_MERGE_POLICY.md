# Pull request merge policy

Repository changes merge only through GitHub pull requests after the exact PR
head has passed all required checks. No GitHub Actions workflow or repository
script may merge a PR or enable auto-merge. Security-sensitive source,
workflow, migration, database, deployment, payment, and integration changes
remain subject to a human owner's explicit review and manual merge decision.

## Owner-controlled merge procedure

1. Keep a security-sensitive PR in Draft while implementation or validation is
   incomplete. Review the full diff, base branch, author, changed-file list,
   and exact head SHA.
2. Confirm these required checks are terminal `success` on that same SHA:
   `Next.js checks`, `Isolated Supabase RPC security tests`, and
   `Production release safety`. A skipped, stale, pending, or failed check is
   not acceptance.
3. Confirm the branch is conflict-free and no new commits or checks are
   pending. If the head changes, repeat review and validation for the new SHA.
4. After the owner has completed review, mark the PR Ready for Review and use
   GitHub's ordinary manual Merge action. Never enable GitHub auto-merge or
   invoke a merge from an Actions workflow.
5. Do not bypass branch protection. The process does not require a second
   collaborator as the only route for owner-controlled development; the owner
   performs the explicit review and merge decision.

If a legacy automation is still present on the current default branch, keep
the governance PR in Draft until all runs for its exact head have completed
while it remains Draft. Then the owner may perform the reviewed, manual
Ready-and-Merge sequence without rerunning or dispatching workflows in between.
