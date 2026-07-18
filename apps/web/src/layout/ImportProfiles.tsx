import { useState } from 'react';
import { Pencil, TriangleAlert, X } from 'lucide-react';
import {
  IMPORT_FORMAT_SPECS,
  previewProfilePattern,
  PROFILE_GROUPS,
  profilePatternBlocker,
  type ImportProfile,
} from '@netplan/domain';
import { buildImportProfile, opCreateEntity, opDeleteEntity, opSetField } from '../state/ops';
import { useAppStore } from '../state/store';
import { Button, IconButton } from '../ui';

/**
 * Import profile authoring (#90 A4): the ImportProfile schema and the
 * netcat-text adapter were fully built — this is the missing UI. List,
 * create, edit and delete go through the ordinary Operations (undoable,
 * audited); the live tester previews a pattern's captured groups over pasted
 * sample lines before the profile ever meets a real file.
 */
export function ImportProfiles() {
  const project = useAppStore((s) => s.project);
  const profiles = useAppStore((s) => s.graph?.importProfiles);
  const dispatch = useAppStore((s) => s.dispatch);
  // 'new' opens the editor on a fresh profile; a profile id edits that one
  const [editing, setEditing] = useState<string | null>(null);
  if (!project) return null;
  const list = profiles ?? [];

  return (
    <details className="import-profiles" data-testid="import-profiles">
      <summary>Import profiles ({list.length})</summary>
      <div className="import-profiles__body">
        <p className="panel-hint">
          A profile is a per-line regex whose named groups (
          {[...PROFILE_GROUPS.required, ...PROFILE_GROUPS.optional].join(', ')}) map free-form scan
          text — it puts the netcat-text adapter in the wizard above.
        </p>
        {list.length === 0 && editing === null && (
          <p className="panel-empty">No profiles yet — create one to unlock netcat-text imports.</p>
        )}
        <ul className="import-profiles__list">
          {list.map((profile) => (
            <li
              key={profile.id}
              className="import-profiles__row"
              data-testid={`profile-row-${profile.name}`}
            >
              <div className="import-profiles__meta">
                <strong>{profile.name}</strong>
                {profile.description && <span> — {profile.description}</span>}
                <code className="import-profiles__pattern">{profile.pattern}</code>
              </div>
              <IconButton
                icon={Pencil}
                size="sm"
                label="Edit this profile"
                data-testid={`profile-edit-${profile.name}`}
                onClick={() => setEditing(profile.id)}
              />
              <IconButton
                icon={X}
                size="sm"
                variant="danger"
                label="Delete this profile"
                data-testid={`profile-delete-${profile.name}`}
                onClick={() =>
                  dispatch(
                    opDeleteEntity(project.id, { entityType: 'importProfile', entity: profile }),
                  )
                }
              />
            </li>
          ))}
        </ul>
        {editing === null ? (
          <Button size="sm" data-testid="profile-new" onClick={() => setEditing('new')}>
            + New profile
          </Button>
        ) : (
          <ProfileEditor
            key={editing}
            profile={editing === 'new' ? null : (list.find((p) => p.id === editing) ?? null)}
            existingNames={new Set(list.map((p) => p.name))}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </details>
  );
}

/** The netcat-text descriptor supplies working defaults for a fresh profile. */
const NETCAT_SPEC = IMPORT_FORMAT_SPECS['netcat-text'];

function ProfileEditor({
  profile,
  existingNames,
  onClose,
}: {
  /** null creates a new profile, prefilled from the descriptor's tested example. */
  profile: ImportProfile | null;
  existingNames: ReadonlySet<string>;
  onClose: () => void;
}) {
  const project = useAppStore((s) => s.project);
  const dispatch = useAppStore((s) => s.dispatch);
  const [name, setName] = useState(profile?.name ?? '');
  const [pattern, setPattern] = useState(
    profile?.pattern ?? NETCAT_SPEC?.exampleProfilePattern ?? '',
  );
  const [description, setDescription] = useState(profile?.description ?? '');
  // the live tester starts on the descriptor's example so the prefilled
  // pattern demonstrates itself immediately
  const [sample, setSample] = useState(NETCAT_SPEC?.example ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!project) return null;

  const preview = previewProfilePattern(pattern, sample);

  function save() {
    if (!project) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name the profile first.');
      return;
    }
    // one gate for everything the schema rejects or the adapter cannot use:
    // empty pattern, invalid regex, missing (?<host>)/(?<port>) groups
    const patternError = profilePatternBlocker(pattern);
    if (patternError) {
      setError(patternError);
      return;
    }
    // renaming onto an existing name is as much a duplicate as creating one
    if (existingNames.has(trimmedName) && trimmedName !== profile?.name) {
      setError(`A profile named ${trimmedName} already exists.`);
      return;
    }
    if (profile === null) {
      dispatch(
        opCreateEntity(project.id, {
          entityType: 'importProfile',
          entity: buildImportProfile(project.id, trimmedName, pattern, description.trim()),
        }),
      );
    } else {
      // one SetField per changed field keeps undo granular and skips no-ops
      const changes: Array<[field: string, next: string, previous: string]> = [
        ['name', trimmedName, profile.name],
        ['pattern', pattern, profile.pattern],
        ['description', description.trim(), profile.description],
      ];
      for (const [field, next, previous] of changes) {
        if (next !== previous) {
          dispatch(opSetField(project.id, 'importProfile', profile.id, field, next, previous));
        }
      }
    }
    onClose();
  }

  return (
    <div className="import-profiles__editor" data-testid="profile-editor">
      <input
        value={name}
        placeholder="Profile name (nc sweep…)"
        data-testid="profile-name-input"
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="import-profiles__pattern-input"
        value={pattern}
        placeholder={`Per-line regex with ${PROFILE_GROUPS.required
          .map((group) => `(?<${group}>…)`)
          .join(' and ')} groups`}
        data-testid="profile-pattern-input"
        onChange={(e) => setPattern(e.target.value)}
      />
      <input
        value={description}
        placeholder="Description (optional)"
        data-testid="profile-description-input"
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && (
        <p className="imports-panel__notice" data-testid="profile-error">
          <TriangleAlert size={12} className="inline-icon" aria-hidden /> {error}
        </p>
      )}
      <label className="import-profiles__sample">
        Sample lines
        <textarea
          value={sample}
          rows={3}
          data-testid="profile-sample-input"
          onChange={(e) => setSample(e.target.value)}
        />
      </label>
      {preview.error ? (
        <p className="imports-panel__notice" data-testid="profile-preview-error">
          <TriangleAlert size={12} className="inline-icon" aria-hidden /> {preview.error}
        </p>
      ) : (
        preview.lines.length > 0 && (
          <table className="data-table import-profiles__preview" data-testid="profile-preview">
            <thead>
              <tr>
                <th>Line</th>
                <th>Captured groups</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((match, index) => (
                <tr key={`${index}-${match.line}`} data-testid="profile-preview-line">
                  <td className="import-profiles__line">{match.line}</td>
                  <td className="import-profiles__groups">
                    {match.groups === null
                      ? 'no match'
                      : Object.entries(match.groups)
                          .map(([group, value]) => `${group}=${value}`)
                          .join(' ') || 'match, no groups'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
      <div className="import-profiles__actions">
        <Button size="sm" variant="primary" data-testid="profile-save" onClick={save}>
          {profile === null ? 'Create profile' : 'Save changes'}
        </Button>
        <Button size="sm" variant="ghost" data-testid="profile-cancel" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
