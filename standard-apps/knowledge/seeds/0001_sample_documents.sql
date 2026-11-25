-- Beispieldaten: vier fiktive interne Dokumente der Northlight Ltd, damit
-- Suche und Chunking sofort etwas zu tun haben.
--
-- Diese Datei legt NUR die Dokumente an, keine Abschnitte. Zerlegt werden
-- sie beim Start in src/instrumentation.ts (`chunkPendingDocuments`), mit
-- derselben Funktion wie `documents.add`. Begruendung steht dort.
--
-- created_by 'system:sample-data' ist keine Nutzer-Id und kann nie mit einer
-- echten Identitaet aus dem Gateway zusammenfallen.

insert into documents (title, source, content, char_count, created_by)
select title, source, content, char_length(content), 'system:sample-data'
from (values
(
  'Travel expense policy',
  'Northlight Ltd, staff handbook chapter 4, January 2026',
  $doc$This policy sets out which travel expenses Northlight Ltd reimburses for business trips. It applies to all employees, apprentices and interns. A business trip is any journey that was ordered or approved for a business reason. Trips to another Northlight Ltd site also count as business trips.

Approval: Every trip must be requested in the travel portal before departure and approved by your direct manager. Trips abroad and trips with expected costs above 1,500 euros also need approval from the head of department. Costs are not reimbursed without approval.

Means of transport: Rail comes first. Journeys of up to 4 hours are booked in second class; longer journeys may be booked in first class. Domestic flights are only allowed if the train journey takes longer than 6 hours. Flights are always booked in economy class.

Mileage allowance: If you drive your own car, you receive a mileage allowance of 0.30 euros per kilometre driven. There is no extra amount for passengers. Parking fees and tolls are reimbursed on top against a receipt. The allowance covers all vehicle costs, including damage to your own car.

Rental cars: A rental car is only allowed if public transport is not reasonable. Book at most a compact car through the framework contract. Extra insurance is not needed; it is included in the framework contract.

Accommodation: The hotel limit is 120 euros per night including breakfast. In Munich, Hamburg, Frankfurt am Main and during trade fairs the limit is 160 euros per night. More expensive hotels need approval in advance with a reason. If no hotel is used, we pay an overnight allowance of 20 euros.

Meals: Domestic trips use the tax allowances. For more than 8 hours away this is 14 euros, for 24 hours 28 euros per day. If breakfast is included in the hotel price, 5.60 euros are deducted, and 11.20 euros for each lunch or dinner provided.

Expense claims: Submit your travel expense claim in the travel portal no later than 4 weeks after the end of the trip. Upload all receipts as a photo or PDF and keep the originals for 3 months. Late claims are only processed with the consent of the head of department. Reimbursement is paid with the next payroll.

Questions about the travel expense policy go to the HR team at travel@northlight.example.$doc$
),
(
  'Guide to writing quotes',
  'Sales handbook v3, section Quotes',
  $doc$This guide describes how the Northlight Ltd sales team writes, prices and approves quotes. The goal is that every quote is complete, traceable and with the customer within 3 working days.

Basis: Every quote is created in the CRM from a template. Free-form quotes in a word processor or an email are not allowed, because they show up neither in the pipeline nor in reporting. Prices come from the current price list, which product management publishes every quarter.

Required details: Every quote contains the customer contact, a description of the service, quantities, unit prices, the total net price, payment terms and a validity of 30 days. Payment terms beyond 30 days need the consent of accounting.

Discount limits: Sales staff may grant up to 10 percent discount on the list price on their own. Discounts of more than 10 and up to 20 percent are approved by the head of sales. Discounts above 20 percent are only possible with the consent of the managing director and must be justified in writing, for example with a strategic new customer or a multi-year contract. Volume discounts from the price list do not count towards these limits.

Approval above an amount: Quotes with a total value of 25,000 euros net or more are approved by the head of sales before they reach the customer. From 100,000 euros net, the managing director must approve as well. Approval runs in the CRM through the status "Pending approval"; approval by email or chat does not count.

Pricing services: Consulting days are priced at the day rate from the price list, currently 1,150 euros net. Travel time is charged at 50 percent of the day rate, travel costs at cost according to the travel expense policy. Fixed prices are only allowed with a risk surcharge of at least 15 percent.

Follow-up: No later than 7 days after sending, sales follows up with the customer. If a quote expires without a response, mark it as "lost" in the CRM and enter the reason, so that reporting stays correct.

Questions about prices and discounts go to the head of sales.$doc$
),
(
  'IT security rules',
  'https://intranet.northlight.example/it/security',
  $doc$These rules apply to all Northlight Ltd employees and to external staff with access to our systems. They protect customer data, trade secrets and day-to-day operations. Breaches can lead to disciplinary action.

Passwords: A password has at least 14 characters. It is not used for any other service and never shared, not even with IT. We recommend the approved password manager. Passwords do not have to be changed regularly, but immediately if you suspect someone knows them.

Two-factor sign-in: Two-factor sign-in is mandatory for email, CRM, accounting and remote access. The second factor is the authenticator app on your work phone or a hardware key. SMS codes are not allowed.

Devices: Work data is only processed on devices managed by IT. Private devices may only access email and calendar through the browser. Lock your screen when you leave your desk; it locks automatically after 5 minutes at the latest. Report lost or stolen devices immediately, even at night and at weekends, using the IT emergency number.

Phishing: Do not open links and attachments in unexpected emails. Forward suspicious messages to IT with the "Report phishing" button. IT never asks for a password by email or phone. If you clicked a link by mistake or entered your credentials, report it immediately; nobody is punished for this.

Software: Only IT installs programs. Cloud services and AI tools may only be used if they are on the list of approved services. Customer data and internal documents are never copied into services that are not approved.

File storage: Documents belong in the approved storage locations, not on local hard drives or USB sticks. Share confidential documents only with people who need them for their work. Sharing links for external people expire after 30 days at most.

Report security incidents to security@northlight.example or by phone to the IT emergency number.$doc$
),
(
  'Product sheet Northlight Lumen',
  'Product management, product sheet Lumen 2026',
  $doc$Northlight Lumen is our platform for controlling lighting in office and commercial buildings. It connects luminaires, presence detectors and daylight sensors, and according to our measurements in existing buildings it cuts the electricity used for lighting by 40 to 60 percent.

Target group: Lumen is aimed at owners and operators of office buildings from about 2,000 square metres, at facility management providers and at retail chains with many branches. Lumen pays off especially when the lighting runs for long hours and has so far been switched by hand.

Features: Lumen switches and dims light based on presence and daylight, follows schedules and calendars, and can be controlled per room, floor or building. The system reports faults in luminaires automatically. An energy report shows consumption per zone and month and works as evidence for energy audits.

Technology: Control runs locally on one gateway per building and keeps working without an internet connection. DALI-2, KNX and Zigbee are supported. The management interface runs in the browser; data is stored only in data centres in Germany. An open interface (REST) allows integration with building management systems.

Plans and prices: Lumen Basic costs 2.50 euros per light point and month and includes control, schedules and fault reports. Lumen Pro costs 3.90 euros per light point and month and also includes energy reports, the interface and a named support contact. The gateway costs a one-off 690 euros. The minimum term is 24 months. On-site setup is charged at cost in consulting days.

Service: Support is available on working days from 8 am to 6 pm. Lumen Pro has a response time of 4 hours for faults that affect a whole building. We install updates without interrupting operations.

Scope: Lumen does not control heating, ventilation or blinds. For these systems we recommend connecting the existing building management system through the interface.$doc$
)
) as seed (title, source, content);
