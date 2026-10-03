export default function ProfileCard({ user }) {
  return (
    <section className="card profile-card">
      <h3>Your profile</h3>
      <img className="avatar" src={user.avatarUrl} alt="" width="64" height="64" />
      <dl>
        <dt>Name</dt>
        <dd>{user.name}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Role</dt>
        <dd>{user.role}</dd>
        <dt>Member since</dt>
        <dd>{new Date(user.joined).toLocaleDateString()}</dd>
      </dl>
      <button type="button">Edit profile</button>
    </section>
  );
}
