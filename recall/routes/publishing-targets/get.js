import db from "../../db.js";

export default async (req, res) => {
  if (!req.authenticated) {
    return res.redirect("/sign-in");
  }
  const userId = req.authentication.user.id;

  const integrations = await db.Integration.findAll({ where: { userId } });
  const targets = await db.PublishTarget.findAll({ where: { userId } });
  const deliveries = await db.PublishDelivery.findAll({
    limit: 20,
    order: [["createdAt", "DESC"]],
    include: [{ model: db.PublishTarget }],
  });

  return res.render("publishing-targets.ejs", {
    notice: req.notice,
    user: req.authentication.user,
    integrations,
    targets,
    deliveries,
  });
};


