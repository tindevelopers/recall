"use strict";

import { Sequelize } from "sequelize";

export const up = async ({ context: { queryInterface } }) => {
  await queryInterface.addColumn("calendars", "useRetellTranscription", {
    type: Sequelize.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
};

export const down = async ({ context: { queryInterface } }) => {
  await queryInterface.removeColumn("calendars", "useRetellTranscription");
};


