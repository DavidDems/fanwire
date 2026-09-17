# The Sideline v2

## Current project: sports discussion app
Scaled-up successor to your prior Twitter-for-sports-clone project. Users post about games, mention real teams/matches, feed pulls live data from a real sports API. Chosen over an outdoor-events (hiking/running/triathlon) version because sports data has one consistent, well-documented multi-league API (API-SPORTS) with a real free tier — outdoor endurance events don't have an equivalent unified source (results/results-adjacent APIs are split across triathlon-only, registration-only, and hiking-has-no-results-concept-at-all providers). See [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] for the provider choice.

Prior stack carried forward: Python + FastAPI + Pydantic + SQLAlchemy, React + TypeScript. Database moves from MySQL to Postgres (see [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] for why).

## Read in this order
1. [[wiki/CodeContext/Standards/design-principles|Design principles]] — universal rules (SOLID, DRY, KISS, 12-factor, security baseline). Apply on every stack.
2. [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] — how all 23 GoF patterns connect in this app's actual domain (feed/posts/events/moderation), and where module boundaries sit.
3. [[wiki/CodeContext/Standards/aws-stack|AWS Stack]] — backend/frontend language choices, the AWS services, and the sports-data ingestion pipeline.
4. [[wiki/CodeContext/Standards/security|Security]] — self-managed AWS security requirements, including the user-generated-content-specific ones (moderation, rate limiting, media scanning).
5. [[wiki/GeneralContext/UsageRules/index|Usage principals]] — how AI agents are used to build and maintain this project.

## Decisions
- **Media uploads are in scope for v1.** Image hosting is AWS-native, not a third-party service: presigned upload to a private S3 quarantine bucket, GuardDuty Malware Protection for S3 scan, Pillow-based type validation/EXIF stripping/resizing, then promotion to a public media bucket served via CloudFront. Stricter limits than the rest of the app (smaller size cap, allow-listed image types only). Full pipeline in [[wiki/CodeContext/Standards/aws-stack|AWS Stack]], the security requirements in [[wiki/CodeContext/Standards/security|Security]], the module/pattern shape in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]].
- **Single sports data provider (API-SPORTS) until it proves insufficient.** No fallback/cross-check provider built preemptively — the `SportsProviderFactory` Abstract Factory in [[wiki/CodeContext/Standards/gof-patterns|Gang of Four Example]] makes adding one later a swap, not a rewrite, so there's no cost to waiting.


## Business rules
**Accounts**:
- User registration using an email and password
- User registration confirmation email
- User forgot password feature
- Storing user data (DOB, description, username, preferred team, profile picture)
- Updating user data
- Soft-deleting user data
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
- Have a sports game result as a part of a post/reply
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

**Notifications:
- Create notifications when certain actions happen (follow, reply or repost, but not like)
- Send a notification by email to a user if someone has followed them, replied to their post, or reposted their post
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

