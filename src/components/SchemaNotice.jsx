import { Alert } from './Icons.jsx';
import { MIGRATION_FILE } from '../lib/schema.js';

/**
 * Shown whenever the app is newer than the database it is talking to.
 *
 * Deliberately specific. "Something went wrong" would leave a non-technical
 * user with nowhere to go, and the raw PostgREST sentence left them with
 * somewhere they could not read. This names the file, says where to paste it,
 * and says what is switched off until they do - which is the whole of the
 * decision they have to make.
 */
export default function SchemaNotice({ what }) {
  return (
    <div className="banner warn">
      <Alert size={16} />
      <div>
        <strong>The database is one migration behind this version of the app.</strong>
        <p>
          {what} Everything else on this screen is live and safe to use.
        </p>
        <p>
          To fix it: open Supabase → SQL Editor, paste the contents of
          {' '}<code>supabase/{MIGRATION_FILE}</code> and Run. It is safe to run twice.
          If you have already run it and still see this, the API schema cache has not
          caught up yet — run <code>notify pgrst, 'reload schema';</code> in the same
          editor, then reload this page.
        </p>
      </div>
    </div>
  );
}
