USE cash_register_closings;

INSERT INTO cash_closings (
  id, shopId, businessDate, posSystemAmount, cardAmount, cashAmount,
  deliveryAppsAmount, transferAmount, accountDniAmount, unitsSold,
  cashLeftInRegister, cashWithdrawn, cashWithdrawnByName,
  declaredTotal, calculatedTotal, difference, tipsAmount, notes, status, createdByUserId, submittedAt, active
) VALUES
(
  'd1111111-1111-1111-1111-111111111114',
  '11111111-1111-1111-1111-111111111111',
  '2026-05-14',
  721975, 473475, 248500, 0, 0, 0, 66,
  28500, 220000, 'Facu Odo',
  721975, 721975, 0, 0, 'Lleva a luz azul (efectivo)', 'SUBMITTED',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', NOW(6), 1
),
(
  'd1111111-1111-1111-1111-111111111125',
  '11111111-1111-1111-1111-111111111111',
  '2026-07-25',
  479750, 306000, 100000, 13800, 38000, 0, 45,
  15000, 0, NULL,
  457800, 457800, 21950, 0, 'Formato estándar Caja/PVS/PedidosYa/Efectivo/Total', 'SUBMITTED',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', NOW(6), 1
),
(
  'd2222222-2222-2222-2222-222222222224',
  '22222222-2222-2222-2222-222222222222',
  '2026-07-24',
  1366320, 854230, 340000, 0, 0, 178000, NULL,
  0, 320000, 'Santiago',
  1372230, 1372230, -5910, 20000, 'Propina 20mil falta Seba, Mati y Kevin', 'SUBMITTED',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NOW(6), 1
),
(
  'd1111111-1111-1111-1111-111111111121',
  '11111111-1111-1111-1111-111111111111',
  '2026-05-21',
  534675, 407950, 206900, 0, 0, 0, 56,
  0, 170000, 'Facu Odo',
  614850, 614850, -80175, 0, 'Lleva a tutto 170mil', 'SUBMITTED',
  'cccccccc-cccc-cccc-cccc-cccccccccccc', NOW(6), 1
)
ON DUPLICATE KEY UPDATE notes = VALUES(notes);

INSERT INTO closing_expenses (id, closingId, label, amount, category) VALUES
  (UUID(), 'd1111111-1111-1111-1111-111111111121', 'Mayonesa', 5400, 'SUPPLIES'),
  (UUID(), 'd1111111-1111-1111-1111-111111111121', 'Wifi', 34000, 'SERVICES');

INSERT INTO closing_extra_lines (id, closingId, type, label, amount, meta) VALUES
  (UUID(), 'd2222222-2222-2222-2222-222222222224', 'PVS_BREAKDOWN', 'PVS terminal 1', 162960, NULL),
  (UUID(), 'd2222222-2222-2222-2222-222222222224', 'PVS_BREAKDOWN', 'PVS terminal 2', 691270, NULL),
  (UUID(), 'd2222222-2222-2222-2222-222222222224', 'TIP_ALLOCATION', 'Propina mozos', 20000,
   '{"employees":["Seba","Mati","Kevin"],"paid":false}');
