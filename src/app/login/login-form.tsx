'use client';

import {
  Alert,
  Button,
  ErrorMessage,
  FormGroup,
  Label,
  TextInput,
} from '@trussworks/react-uswds';

interface Props {
  hasError: boolean;
}

export default function LoginForm({ hasError }: Props) {
  return (
    <>
      {hasError && (
        <Alert
          type="error"
          headingLevel="h2"
          slim
          className="margin-bottom-3"
          aria-live="polite"
        >
          That password was not correct. Try again.
        </Alert>
      )}
      <form action="/api/auth" method="post" noValidate>
        <FormGroup error={hasError}>
          <Label htmlFor="password">Demo password</Label>
          {hasError && (
            <ErrorMessage id="password-error">
              Password did not match.
            </ErrorMessage>
          )}
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={hasError ? 'password-error' : undefined}
            autoFocus
          />
        </FormGroup>
        <Button type="submit" className="margin-top-3">
          Continue
        </Button>
      </form>
    </>
  );
}
