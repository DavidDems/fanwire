import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";

import type { components } from "../../api/schema";
import { PROFILE_QUERY_KEY } from "../../auth/profile";
import { Field, describeField } from "../../components/FormField";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { TEAMS_QUERY_KEY, fetchTeams, updateMe } from "./api";
import styles from "./Profile.module.css";

/**
 * The two editable fields of the caller's own profile, on the own-profile view.
 *
 * **The body is a patch.** Only the controls whose value differs from the loaded
 * profile are put in it; the rest are absent, not `null`. The backend reads the
 * body with `model_fields_set` semantics ([[0x01-users]]) — absent means "leave
 * it", `null` means "clear it" — so sending every field on every save would
 * silently wipe whatever the user did not touch.
 *
 * `username` and `date_of_birth` are not on `UpdateMeRequest` at all and are
 * deliberately not editable here.
 *
 * **No profile-picture control.** The upload widget belongs to `FRONTEND-004`,
 * which has not landed; a second uploader here would be a duplicate media path
 * ([[0x00-architecture]] Connection rule) and would need deleting rather than
 * merging. `profile_picture_media_id` is therefore never sent.
 */

type MeOut = components["schemas"]["MeOut"];
type UpdateMeRequest = components["schemas"]["UpdateMeRequest"];

export interface ProfileSettingsProps {
  /** The caller's own profile, already loaded — this is what the form diffs against. */
  profile: MeOut;
}

/** The select's value is a string; `""` is "no preference", which is a real choice. */
function teamValue(preferredTeamId: number | null): string {
  return preferredTeamId === null ? "" : String(preferredTeamId);
}

export function ProfileSettings({ profile }: ProfileSettingsProps) {
  const queryClient = useQueryClient();
  const teams = useQuery({ queryKey: TEAMS_QUERY_KEY, queryFn: fetchTeams });

  const [description, setDescription] = useState(profile.description ?? "");
  const [preferredTeamId, setPreferredTeamId] = useState(
    teamValue(profile.preferred_team_id),
  );
  const [failure, setFailure] = useState<string | null>(null);
  /** What the status line says, and whether it is the saved confirmation or a neutral aside. */
  const [note, setNote] = useState<{
    text: string;
    variant: "neutral" | "success";
  } | null>(null);

  const save = useMutation({
    mutationFn: (body: UpdateMeRequest) => updateMe(body),
    onSuccess: async () => {
      // One shared react-query entry for `GET /users/me` ([[0x08-frontend]]),
      // and the app's `staleTime` is 30s — without this the guards and this page
      // keep believing the profile the user just changed.
      await queryClient.invalidateQueries({
        queryKey: PROFILE_QUERY_KEY,
        exact: true,
      });
      setNote({ text: "Your profile has been saved.", variant: "success" });
    },
    onError: () => {
      setFailure("We could not save your profile. Please try again.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFailure(null);
    setNote(null);

    const body: UpdateMeRequest = {};

    const trimmed = description.trim();
    if (trimmed !== (profile.description ?? "")) {
      // Emptied on purpose is the one case `null` is right for: the user is
      // asking for the description to be cleared, not left alone.
      body.description = trimmed === "" ? null : trimmed;
    }
    if (preferredTeamId !== teamValue(profile.preferred_team_id)) {
      body.preferred_team_id =
        preferredTeamId === "" ? null : Number(preferredTeamId);
    }

    if (Object.keys(body).length === 0) {
      setNote({ text: "There is nothing to save yet.", variant: "neutral" });
      return;
    }
    save.mutate(body);
  }

  // The select cannot show the profile's current team before the choices exist,
  // so the form waits for them rather than rendering with the value unselected.
  if (teams.isPending) return <StatusLine>Loading your settings…</StatusLine>;

  return (
    <Card as="section" className={styles.settings}>
      <h2>Settings</h2>

      {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}
      {note === null ? null : (
        <StatusLine variant={note.variant}>{note.text}</StatusLine>
      )}
      {teams.isError ? (
        <InlineAlert>We could not load the list of teams.</InlineAlert>
      ) : null}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <Field id="profile-settings-description" label="Description">
          <textarea
            {...describeField("profile-settings-description")}
            name="description"
            rows={3}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>

        <Field id="profile-settings-team" label="Preferred team">
          <select
            {...describeField("profile-settings-team")}
            name="preferred-team"
            value={preferredTeamId}
            onChange={(event) => {
              setPreferredTeamId(event.target.value);
            }}
          >
            <option value="">No preference</option>
            {(teams.data ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </Field>

        <Button
          type="submit"
          variant="primary"
          size="md"
          className={styles.save}
          disabled={save.isPending}
        >
          Save
        </Button>
      </form>
    </Card>
  );
}
