INSERT INTO action_definitions (action_key, label, role, action_type, enabled, sort_order) VALUES
  ('to_detail', 'Take Car To Detail', 'bmw_genius', 'status', TRUE, 10),
  ('detail_started', 'Start Detail', 'detailer', 'status', TRUE, 20),
  ('detail_finished', 'Finish Detail', 'detailer', 'status', TRUE, 30),
  ('removed_from_detail', 'Bring Car Up From Detail', 'bmw_genius', 'status', TRUE, 40),
  ('complete_qc', 'Complete QC', 'manager', 'flag', TRUE, 50),
  ('start_service', 'Service Started', 'service_advisor', 'flag', TRUE, 60),
  ('complete_service', 'Complete Service', 'service_advisor', 'flag', TRUE, 70),
  ('start_bodywork', 'Body Work Started', 'service_advisor', 'flag', TRUE, 80),
  ('complete_bodywork', 'Complete Body Work', 'service_advisor', 'flag', TRUE, 90),
  ('toggle_recall', 'Recalls Checked', 'service_advisor', 'flag', TRUE, 100),
  ('complete_recall', 'Recall Completed', 'service_advisor', 'flag', TRUE, 110),
  ('toggle_fueled', 'Fuel The Car', 'bmw_genius', 'flag', TRUE, 120),
  ('ready', 'Mark Ready', 'manager', 'status', TRUE, 130);
