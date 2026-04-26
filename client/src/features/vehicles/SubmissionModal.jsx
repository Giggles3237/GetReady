export default function SubmissionModal({
  isOpen,
  onClose,
  createVehicle,
  hasManagerAccess,
  submission,
  setSubmission,
  authUser,
  salespersonUsers,
  assignableUsers,
  roleOptions
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="detail-overlay">
      <section className="detail-modal submission-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">New Get Ready</p>
            <h2>Submit Unit</h2>
          </div>
          <button type="button" className="secondary-btn" onClick={onClose}>Close</button>
        </div>

        <form className="control-card modal-form" onSubmit={createVehicle}>
          <label>
            Salesperson
            {hasManagerAccess ? (
              <select
                value={submission.submitted_by_user_id || authUser.id}
                onChange={(event) => setSubmission((current) => ({ ...current, submitted_by_user_id: event.target.value }))}
              >
                {salespersonUsers.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            ) : (
              <input value={authUser.name} readOnly />
            )}
          </label>

          {hasManagerAccess ? (
            <label>
              Assigned User
              <select
                value={submission.assigned_user_id}
                onChange={(event) => setSubmission((current) => ({ ...current, assigned_user_id: event.target.value }))}
              >
                <option value="">Unassigned</option>
                {assignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} | {roleOptions.find((option) => option.value === user.role)?.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label>
            Stock Number
            <input value={submission.stock_number} onChange={(event) => setSubmission((current) => ({ ...current, stock_number: event.target.value }))} required />
          </label>
          <label>
            Year
            <input type="number" value={submission.year} onChange={(event) => setSubmission((current) => ({ ...current, year: event.target.value }))} required />
          </label>
          <label>
            Model
            <input value={submission.model} onChange={(event) => setSubmission((current) => ({ ...current, model: event.target.value }))} required />
          </label>
          <label>
            Color
            <input value={submission.color} onChange={(event) => setSubmission((current) => ({ ...current, color: event.target.value }))} />
          </label>
          <label>
            Due Date
            <input type="datetime-local" value={submission.due_date} onChange={(event) => setSubmission((current) => ({ ...current, due_date: event.target.value }))} required />
          </label>
          <label><input type="checkbox" checked={submission.needs_service} onChange={(event) => setSubmission((current) => ({ ...current, needs_service: event.target.checked }))} /> Needs Service</label>
          {submission.needs_service ? (
            <label>
              Service Notes
              <input value={submission.service_notes} onChange={(event) => setSubmission((current) => ({ ...current, service_notes: event.target.value }))} placeholder="Enter service notes..." />
            </label>
          ) : null}
          <label><input type="checkbox" checked={submission.needs_bodywork} onChange={(event) => setSubmission((current) => ({ ...current, needs_bodywork: event.target.checked }))} /> Needs Body Work</label>
          {submission.needs_bodywork ? (
            <label>
              Body Work Notes
              <input value={submission.bodywork_notes} onChange={(event) => setSubmission((current) => ({ ...current, bodywork_notes: event.target.value }))} placeholder="Enter body work notes..." />
            </label>
          ) : null}
          <label><input type="checkbox" checked={submission.qc_required} onChange={(event) => setSubmission((current) => ({ ...current, qc_required: event.target.checked }))} /> QC Required</label>
          <label>
            Notes
            <input value={submission.notes} onChange={(event) => setSubmission((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <button className="primary-btn" type="submit">Submit Unit</button>
        </form>
      </section>
    </div>
  );
}
