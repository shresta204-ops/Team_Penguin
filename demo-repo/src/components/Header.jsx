export default function Header() {
  return (
    <header className="app-header">
      <span className="logo">Penguin Dashboard</span>
      <nav>
        <a href="#overview">Overview</a>
        <a href="#projects">Projects</a>
        <a href="#settings">Settings</a>
      </nav>
      <button type="button" className="sign-out">Sign out</button>
    </header>
  );
}
