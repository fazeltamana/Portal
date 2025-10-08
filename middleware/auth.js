// middleware/auth.js
export function ensureAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }
  next();
}

export function ensureRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect("/auth/login");
    }

    const userRoles = req.session.user.roles || []; // array of role names
    const hasRole = userRoles.some((r) => allowedRoles.includes(r));

    if (!hasRole) {
      return res.status(403).send("Forbidden: insufficient role");
    }
    next();
  };
}
