---
type: reference
---

# Product scope and business rules

fanwire is an NBA discussion app: users post about games, mention real teams
and games, and read the games' data. Why sports and not outdoor events, the
stack carried forward (and MySQL to Postgres), media uploads in v1 on an
AWS-native pipeline, and the single sports-data source are
[ADR 0032](../Decisions/0032-product-scope-nba-discussion-app.md). The
standards that apply on every change are listed in
[index.md](../index.md) "Standards".

## Business rules
**Accounts**:
- User registration using an email and password
- Email verification is optional: it never gates sign-in or use, and a user verifies later from Account settings ([[wiki/CodeContext/Modules/0x01b-users-auth|0x01b]], [ADR 0031](../Decisions/0031-launch-adjustments.md))
- User forgot password feature: native Cognito recovery to a verified address ([[wiki/CodeContext/Modules/0x01b-users-auth|0x01b]])
- Storing user data (DOB, description, username, preferred team, profile picture)
- Updating user data
- Deactivating an account (a soft delete, recoverable) and deleting one's data (a hard delete) ([ADR 0030](../Decisions/0030-post-deletion-deactivation-and-attachments.md), [ADR 0031](../Decisions/0031-launch-adjustments.md))
- Storing user relationships (following/followed join tables)
- Preventing any action that requires a data write to unregistered users (auth)
- Viewing other users' account pages
- Following and unfollowing other users'

**Posts**:
- Create a post
- Interact with a post (like, repost or hamburger button)
- Reply to a post (a post that is flagged as a reply in the db)
- Storing posts (reposts and replies are posts, but with flags)
- Have images as a part of a post/reply
- Attach sports data to a non-reply post: a game's final score, a player's line in one game, or a player's career averages ([[wiki/CodeContext/Modules/0x03b-posts-actions|0x03b]])
- Report a post (no justification feature, just a flag) through hamburger option
- Copy a posts' link through hamburger button
- Ensure code injections are impossible when creating a post

**Events**:
- Import an existing database of NBA game results (only this for now)
- Create an API to serve the data of these game from the database to the website
- Have a dedicated stats section of the website for viewing historical season stats (champions, team records during the regular season, stats leaders)
- Posts with a link to a game should be clickable to go to the stats page of that game

**Feed**:
- Some type of feed algorithm must be used for presenting posts to the user in the home page
- The feed should draw from user likes, user follows and things like preferred team
- There needs to be a guest feed, for users that have not yet registered, what the user sees when they land on the website for the first time
- The feed can be simple

**Notifications:**
- Create notifications when certain actions happen (follow, reply or repost, but not like)
- Send a notification by email to a user if someone has followed them, replied to their post, or reposted their post. Built, but email is off in production ([[wiki/CodeContext/Modules/0x05-notifications|0x05]] "Email is off in production")
- Store notifications and display them in the website
- Allow the user to clear notifications (soft-delete)
- Allow the user to block email notifications but not the UI for the in-website notifications.

**Search:**
- Have a search bar in the home page and in a separate tab of the website
- The search bar searches for accounts first and posts secondly
- NBA game data can only be filtered by year, team or position, no search bar for anything sports data, that will be too complex
- Ensure code injections are impossible in the search bar

**Images:**
- Media is allowed to be uploaded but only images, no videos
- Store the images and serve them in the website
- Sanitize all images for security, cost and sizing purposes
- Fortify the file upload/handler to ensure no malicious files can be processed


**There will be no moderation or reporting for now, only a reported flag on posts with a table for all reported cases**.
That means no moderation workflow: the pre-publish checks in
[[wiki/CodeContext/Modules/0x03-posts|0x03]] (profanity filter, rate limit,
spam score) are not one, and a report is a row in
[[wiki/CodeContext/Modules/0x03d-posts-reports|0x03d]].
