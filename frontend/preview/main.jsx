import { installMock } from "./mock.js";

// Boot order matters: the fixture-backed fetch must be in place and the
// session token set before the app module runs, because it renders on
// import and the shell asks for /api/me at once.
installMock().then(() => import("../src/main.jsx"));
