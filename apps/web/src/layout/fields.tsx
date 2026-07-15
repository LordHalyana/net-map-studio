import { useEffect, useState, type ReactNode } from 'react';

/** Text input that commits on blur or Enter — every commit becomes one Operation. */
export function TextField(props: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  testId?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <input
        value={draft}
        placeholder={props.placeholder}
        data-testid={props.testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== props.value) props.onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(props.value);
        }}
      />
    </label>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onCommit: (next: string) => void;
  testId?: string;
}) {
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      <select
        value={props.value}
        data-testid={props.testId}
        onChange={(e) => {
          if (e.target.value !== props.value) props.onCommit(e.target.value);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextAreaField(props: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  testId?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  return (
    <label className="field field--stacked">
      <span className="field__label">{props.label}</span>
      <textarea
        value={draft}
        rows={3}
        data-testid={props.testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== props.value) props.onCommit(draft);
        }}
      />
    </label>
  );
}

export function FieldSection(props: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="field-section" data-testid={props.testId}>
      <h3 className="field-section__title">{props.title}</h3>
      {props.children}
    </section>
  );
}
