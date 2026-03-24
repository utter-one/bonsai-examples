# Setup

Note: The demo implementation below is adapted for version 0.2.0 of Bonsai

## 1. Import Bonsai Project

To add the Lead Qualifier Demo project, start by going to the “Administration” section and select “Projects”.

There you will find the “Import Project” button

![Screenshot1](screenshots/1.png)

After importing the correct file "project-lead_qualifier_demo", you should receive the following message:

![Screenshot2](screenshots/2.png)

In the "Projects" section, you should now see your new project and be able to edit it.

![Screenshot3](screenshots/3.png)

When you click "Edit", you will enter the "Edit Project" section where you can change project settings such as name and color. Adjust the Timezone to your time zone.

![Screenshot4](screenshots/4.png)

## 2. Set up providers and API keys

In the "Voice" subsection, you will also find the ASR provider. By default, the project is set to "Azure Speech Recognition". If you want, you can change the provider here (this will require adding different API keys).

![Screenshot5](screenshots/5.png)

Next, in the "API Keys" subsection, you can generate API keys needed to open conversations both through your system and in the Playground. Click "Create API Key".

![Screenshot6](screenshots/6.png)

Without an API key, you would not be able to use the Playground.

![Screenshot7](screenshots/7.png)

When creating an API key, provide its name to create a key for the given project.

![Screenshot8](screenshots/8.png)

After entering the name, you will create a key that will be available in the Playground, and you can also copy it for use in your application.

![Screenshot9](screenshots/9.png)

Next, let’s move to the design section. In the Agent section, you can check and edit which TTS model is used to generate voice responses. By default, the project uses "Deepgram TTS".

![Screenshot10](screenshots/10.png)
![Screenshot12](screenshots/12.png)

In the remaining sections such as Stages, Classifiers, Context Transformers, we currently use the Gemini provider.

![Screenshot15](screenshots/15.png)

To configure these providers, we need to return to the "Administration" section and select the "Providers" option.

![Screenshot39](screenshots/39.png)

Here we are interested in adding the following providers:
- Deepgram TTS
- Azure Speech Recognition
- Gemini LLM

![Screenshot43](screenshots/43.png)
![Screenshot40](screenshots/40.png)

To do this, click "New Provider", where you can add the provider name.

![Screenshot44](screenshots/44.png)

Then, in the second tab "Configuration", select the Provider Type and a specific API Type from those currently supported by the system. After selecting, add your credentials.
![Screenshot45](screenshots/45.png)

Save the provider and repeat for the remaining required providers. Remember that if you decided to edit entities in the project, you must connect the appropriate providers.

## 3. Customize your AI lead qualifier

Once this is done, we can move on to filling in data about our organization, for which the bot will qualify leads. To do this, go to Design --> Global Memory --> Constants

![Screenshot25](screenshots/25.png)

Here you need to fill in the required fields for the flow to work.

- timezone: Here you define the time zone of your office, which will be used by the agent to properly understand the calendar.
- work_start and work_end – The hours during which you should be available for calls.
- calendar_id – The ID of the Google calendar that you must retrieve and insert so the assistant can actually fetch the current calendar and add a new meeting to it. Potentially, you can use another calendar ID here if you plan to modify the webhook integration.
- company_name – The name of your company
- company_description – A description of your company
- assistant_name – The assistant’s name
- company_talking_points – A list of features of your business that the assistant should be able to highlight when qualifying a lead.
- qualification_matrix – The most important configuration element: this is where you define the types of projects you are interested in and warn the AI about red flags for projects you would not want to accept. We suggest using the structure below:

### **B — Budget**

**Ideal:**

* [Define ideal budget range or level]

**Flexible:**

* [Conditions under which a lower budget is acceptable]

**Not a fit:**

* [Minimum threshold / disqualifying budget conditions]

---

### **A — Authority**

**Ideal:**

* [Decision-making roles / stakeholders]

**Acceptable:**

* [Influencers with partial decision power]

**Not a fit:**

* [No authority / no access to budget]

---

### **N — Need**

**Core strength:**

* [Primary specialization / core capability]

**Broad scope (priority areas):**

* [Key solution categories or services]
* [Additional relevant areas]

**Still in scope (conditional):**

* [Supporting work only if aligned with core offering]

**Out of scope:**

* [Clearly excluded types of projects]

---

### **T — Timing**

**Ideal:**

* [Preferred project start timeframe]
* [Clarity of problem and intent]

**Acceptable:**

* [Conditions for early-stage or exploratory work]

**Not a fit:**

* [Lack of urgency, clarity, or commitment]

---

### **In scope examples:**

* [Example use case]
* [Example use case]
* [Example use case]

### **Out of scope examples:**

* [Example to avoid]
* [Example to avoid]
* [Example to avoid]

---

### **🚩 Red Flags**

* [Unqualified or risky signals]
* [Misalignment indicators]
* [Lack of ownership or clarity]
* [Superficial or misguided approach]

After setting this data, we need to handle the tools for calendar access.

## 4. Set up call booking automation in make.com

Let’s start with preparing the integration. Ultimately, you can build the integration in any way via a webhook, but we have prepared a ready example for you with blueprints on make.com.

To do this, go to the website, log in, and create a new scenario where you import the blueprints "bonsai Calendar GET.blueprint" and "bonsai Calendar Schedule.blueprint".

![Screenshot46](screenshots/46.png)

After selecting the file, click "Save" to upload the blueprint.

![Screenshot48](screenshots/48.png)

Next, in the blueprint, go to the Webhook module and click "Create a webhook", setting its name and generating a URL to copy and use in Bonsai.

Also set the execution from scheduled to immediate and activate the scenario.

![Screenshot49](screenshots/49.png)

As a result, you should have two ready integrations.

The first integration is Check Calendar. It retrieves from your calendar a list of meetings for the next two weeks to inform the assistant which time slots are already occupied. The result is returned as a string list of occupied dates.
![Screenshot50](screenshots/50.png)

The second integration is Schedule Call. It receives from Bonsai data about the date, meeting name, and client email, sets up a meeting in the calendar, and returns a link.
![Screenshot51](screenshots/51.png)

Once the integrations are ready, we need to return to Bonsai and connect them to our calendar tools.

To do this, go to Design --> Tools --> Webhook

![Screenshot26](screenshots/26.png)

Enter each tool, where there is already a prepared schema sent to the webhook, and in the URL field provide your webhook address from Make. Do this accordingly for check_calendar and schedule_call.

![Screenshot41](screenshots/41.png)

![Screenshot42](screenshots/42.png)

## 5. Now you can test the experience in Bonsai Playground

Now that we have all the data ready, we can proceed to testing. Go to the "Playground" section and choose text or voice conversation mode.

![Screenshot28](screenshots/28.png)

![Screenshot29](screenshots/29.png)

Then start a conversation by selecting "Lead Qualifier".

![Screenshot30](screenshots/30.png)

After the bot’s initial message, before responding, we need to simulate filling out the contact form. To do this, click "Run Action".

![Screenshot31](screenshots/31.png)

Select Stage Action and the action "client_provide_user_data".

![Screenshot32](screenshots/32.png)

![Screenshot33](screenshots/33.png)

Then fill in the parameters with user data.

![Screenshot34](screenshots/34.png)

At this point, you can freely converse with the assistant and also review the changing data and detected actions.

![Screenshot35](screenshots/35.png)

![Screenshot36](screenshots/36.png)

![Screenshot37](screenshots/37.png)

![Screenshot38](screenshots/38.png)

Congratulations, you have configured the Lead Qualifier demo!