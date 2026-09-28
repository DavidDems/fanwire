/**
 * The identity both profile variants show: the username, and the two counts.
 *
 * **It takes three scalars, never a user object.** That is the point of the
 * file. The backend's public user response leaked `date_of_birth` once already
 * and was fixed by splitting `PublicUserOut` off `MeOut`; the frontend is the
 * second place the same leak happens — by rendering one header that takes a
 * whole user and shows every field it finds. A component that is only ever
 * handed a name and two numbers cannot render a third field, whatever the
 * caller has in scope.
 *
 * The counts are single text nodes rather than a number next to a word, so the
 * element's whole text is what a reader (and a test) sees.
 */

export interface ProfileSummaryProps {
  username: string;
  followerCount: number;
  followingCount: number;
}

export function ProfileSummary({ username, followerCount, followingCount }: ProfileSummaryProps) {
  return (
    <header>
      <h1>{username}</h1>
      <ul>
        <li>{`${followerCount} followers`}</li>
        <li>{`${followingCount} following`}</li>
      </ul>
    </header>
  );
}
