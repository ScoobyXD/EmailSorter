Purpose:
We're going to be the very best at triaging email and observing whats going on in them.

User Preferences:
1. When I ask you to create a new git worktree, I always mean to create a new git worktree in a brand new codex instance. And make sure to number them, like # <worktree name>
2. Don't make new questions for Jev without asking me first, just tell me "hey im going to make a new Jev question here, please audit"
3. DO NOT MAKE UNIT TESTS, NO UNIT TESTS, DO NOT RUN UNIT TESTS.
4. When writing docs/tests I want business logic or rules written down in a numbered list, no long essays, or anything verbose. Literally just line by line rules we've made written down concisely.
5. Do not write unnecessary loops for no reason at all.
6. Do not create things that already exist in our code base.
7. Keep a unified frontend and backend api structure
8. Do not create duplicate or similar data structures for the exact or similar thing.

Jev rules:
1. Don't put 1 question per call. Bunch them up.
2. Keep the state input sent to Jev minimal
3. Don't ask arithmetic/date questions to Jev
4. Pin the Jev model we are doing, the configurations and tuning we're doing for this Jev model may not carry over to the next
5. Nouls are supposed to map into if statements, choice to switchable enums, and score to some threshold.
6. For Jev/TypeSafe work, use the official `typesafe-ai` skill from https://github.com/typesafe-ai/skills. Read the installed skill, or `skills/typesafe-ai/SKILL.md` if it is not installed, and consult the relevant live TypeSafe docs as it directs. The project-specific rules above take precedence over generic skill guidance.
