// Real-world git stderr samples for classifier coverage.
export const STDERR_SAMPLES = {
  conflict_rebase: `Auto-merging notes/foo.md
CONFLICT (content): Merge conflict in notes/foo.md
error: could not apply abc1234... edit foo
hint: Resolve all conflicts manually, mark them as resolved with
hint: "git add/rm <conflicted_files>", then run "git rebase --continue".`,
  conflict_merge: `Auto-merging notes/foo.md
CONFLICT (content): Merge conflict in notes/foo.md
Automatic merge failed; fix conflicts and then commit the result.`,
  push_rejected: `To github.com:user/repo.git
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'github.com:user/repo.git'
hint: Updates were rejected because the tip of your current branch is behind`,
  network_resolve: `fatal: unable to access 'https://github.com/user/repo.git/': Could not resolve host: github.com`,
  network_timeout: `ssh: connect to host github.com port 22: Connection timed out
fatal: Could not read from remote repository.`,
  network_unable: `fatal: unable to access 'https://github.com/user/repo.git/': Failed to connect to github.com port 443`,
  auth_publickey: `git@github.com: Permission denied (publickey).
fatal: Could not read from remote repository.
Please make sure you have the correct access rights and the repository exists.`,
  auth_failed: `remote: Invalid username or password.
fatal: Authentication failed for 'https://github.com/user/repo.git/'`,
  unknown: `fatal: not a valid object name HEAD`,
};
