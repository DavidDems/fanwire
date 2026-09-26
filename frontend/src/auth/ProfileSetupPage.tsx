import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { apiClient } from "../api/client";
import type { components } from "../api/schema";
import { Field, describeField } from "../components/FormField";
import { PROFILE_QUERY_KEY } from "./profile";

/**
 * Creating the application profile.
 *
 * Sign-up created the Cognito identity; this creates the `User` row, and it is
 * the only place in the app that sends `date_of_birth` ([[0x01-users]]: the
 * field is PII, returned only on the owner's own paths and never rendered on a
 * public profile).
 *
 * The age gate lives on the server — a Pydantic validator that answers 422 with
 * `date_of_birth` in `detail[].loc`. It is not re-implemented here: validating
 * in two places is how the two rules drift apart, and the server is the
 * boundary. What this page owes is putting that 422 on the field it is about,
 * with the server's own wording, instead of a banner about a rule the form
 * never mentioned.
 */

type CreateUserRequest = components["schemas"]["CreateUserRequest"];
type TeamOut = components["schemas"]["TeamOut"];
type ValidationError = components["schemas"]["ValidationError"];

type ProfileField = "username" | "dateOfBirth" | "description" | "preferredTeam";

/** `detail[].loc` names the request field; these are this form's controls. */
const CONTROL_FOR_FIELD: Readonly<Record<string, ProfileField>> = {
  username: "username",
  date_of_birth: "dateOfBirth",
  description: "description",
  preferred_team_id: "preferredTeam",
};

/** `preferred_team_id` is a real FK into `events/`'s `Team`, so the choices come from the API. */
async function fetchTeams(): Promise<TeamOut[]> {
  const { data, response } = await apiClient.GET("/events/teams");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /events/teams answered ${response.status}`);
  }
  return data;
}

interface CreateProfileResult {
  /** Field messages from a 422, keyed by control. Empty when the profile was created. */
  rejected: Partial<Record<ProfileField, string>>;
  /** A failure about the request rather than about a control. */
  alert: string | null;
}

/**
 * The 422 the age gate produces, turned into field messages.
 *
 * The server's own `msg` is surfaced verbatim: this is the one error on this
 * page the user can do nothing about by retyping, so telling them what the rule
 * actually is matters more than house style.
 */
function rejectionsFrom(detail: ValidationError[] | undefined): CreateProfileResult {
  const rejected: Partial<Record<ProfileField, string>> = {};
  let unattributed: string | null = null;

  for (const problem of detail ?? []) {
    const named = problem.loc[problem.loc.length - 1];
    const control = typeof named === "string" ? CONTROL_FOR_FIELD[named] : undefined;
    if (control === undefined) {
      unattributed ??= problem.msg;
      continue;
    }
    rejected[control] = problem.msg;
  }

  // A 422 that named nothing this form renders still has to say something.
  if (Object.keys(rejected).length === 0 && unattributed === null) {
    unattributed = "We could not create your profile from those details.";
  }
  return { rejected, alert: Object.keys(rejected).length === 0 ? unattributed : null };
}

async function createProfile(body: CreateUserRequest): Promise<CreateProfileResult> {
  const { data, error, response } = await apiClient.POST("/users", { body });

  if (response.status === 422) return rejectionsFrom(error?.detail);
  if (response.status === 409) {
    // One 409 covers a duplicate username, a duplicate identity and an unknown
    // team ([[0x01-users]]), so it cannot honestly be pinned to one control.
    return { rejected: {}, alert: "That username is already taken, or that team no longer exists." };
  }
  if (!response.ok || data === undefined) {
    return { rejected: {}, alert: "We could not create your profile. Please try again." };
  }
  return { rejected: {}, alert: null };
}

export function ProfileSetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [description, setDescription] = useState("");
  const [preferredTeamId, setPreferredTeamId] = useState("");
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);

  const teams = useQuery({ queryKey: ["events", "teams"], queryFn: fetchTeams });

  const create = useMutation({
    mutationFn: createProfile,
    onSuccess: async (result) => {
      setErrors(result.rejected);
      setFailure(result.alert);
      if (result.alert !== null || Object.keys(result.rejected).length > 0) return;

      // The guards share one cache entry for `GET /users/me`, and the app's
      // `staleTime` is 30s. Without this the 404 that sent the user here is
      // still cached and still believed, and the guard bounces them straight
      // back to this form. Awaited, so the guard above this page re-reads the
      // profile before anything navigates on the strength of the old answer.
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      navigate("/", { replace: true });
    },
    onError: () => {
      setFailure("We could not create your profile. Please try again.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setErrors({});
    setFailure(null);

    // Empty is not a value for either optional field: `preferred_team_id` is an
    // FK and `description` is nullable text, and `""` is something the backend
    // would have to reject.
    const trimmed = description.trim();
    create.mutate({
      username: username.trim(),
      date_of_birth: dateOfBirth,
      ...(trimmed === "" ? {} : { description: trimmed }),
      ...(preferredTeamId === "" ? {} : { preferred_team_id: Number(preferredTeamId) }),
    });
  }

  return (
    <section>
      <h1>Create your profile</h1>

      {failure === null ? null : <p role="alert">{failure}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <Field id="profile-username" label="Username" error={errors.username}>
          <input
            {...describeField("profile-username", { error: errors.username })}
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        </Field>

        <Field
          id="profile-date-of-birth"
          label="Date of birth"
          error={errors.dateOfBirth}
          hintText="Only you can see this. It is never shown on your profile."
        >
          <input
            {...describeField("profile-date-of-birth", { error: errors.dateOfBirth, hint: true })}
            type="date"
            name="date-of-birth"
            value={dateOfBirth}
            onChange={(event) => {
              setDateOfBirth(event.target.value);
            }}
          />
        </Field>

        <Field id="profile-description" label="Description" error={errors.description}>
          <textarea
            {...describeField("profile-description", { error: errors.description })}
            name="description"
            rows={3}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>

        <Field id="profile-team" label="Preferred team" error={errors.preferredTeam}>
          <select
            {...describeField("profile-team", { error: errors.preferredTeam })}
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

        <button type="submit" disabled={create.isPending}>
          Create profile
        </button>
      </form>
    </section>
  );
}
