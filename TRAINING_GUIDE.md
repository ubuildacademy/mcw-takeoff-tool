# AI Takeoff Agent Training Guide

## 🎯 **Overview**

The AI Takeoff Agent learns from human examples to perform accurate construction takeoffs. This guide explains how to train the agent effectively.

## 📚 **Training Process**

### 1. **Data Collection Phase**
- **Human Examples**: Record how you perform takeoffs manually
- **Action Tracking**: Capture every click, drag, and measurement you make
- **Feedback Collection**: Rate accuracy and provide improvement notes

### 2. **Pattern Learning Phase**
- **Common Patterns**: Identify recurring patterns in your actions
- **Scope-Specific Learning**: Train on specific scopes (doors, windows, flooring, etc.)
- **Accuracy Improvement**: Use feedback to improve AI prompts

### 3. **Validation Phase**
- **Test Performance**: Compare AI results with human examples
- **Iterative Improvement**: Refine training based on results
- **Continuous Learning**: Keep training as you encounter new scenarios

## 🚀 **How to Train the Agent**

### **Step 1: Start a Training Session**

1. **Open a Project**: Navigate to a project with a PDF loaded
2. **Enter Training Mode**: Click the "Training Mode" button
3. **Define Scope**: Enter what you want to train on (e.g., "count the king units")
4. **Begin Recording**: Start performing the takeoff manually

### **Step 2: Perform Manual Takeoff**

1. **Create Conditions**: Set up conditions as you normally would
2. **Place Measurements**: Click and drag to place measurements
3. **Record Actions**: Every action is automatically recorded
4. **Complete Takeoff**: Finish the takeoff as you normally would

### **Step 3: Provide Feedback**

1. **Rate Accuracy**: Rate how accurate your manual takeoff was (0-100%)
2. **Add Notes**: Provide feedback about the process
3. **Complete Session**: Submit the training session

## 📊 **Training Data Types**

### **Human Actions Recorded**
- **Clicks**: Where you click on the PDF
- **Drags**: Measurement lines you draw
- **Selections**: Conditions you select
- **Measurements**: Values you calculate

### **Metadata Collected**
- **Coordinates**: Exact pixel locations of actions
- **Timestamps**: When each action occurred
- **Condition Names**: What you named conditions
- **Measurement Types**: Area, linear, count, volume
- **Values**: Calculated measurements

## 🎯 **Training Best Practices**

### **1. Scope-Specific Training**
```
✅ Good: "Count the king units on page 11"
✅ Good: "Measure LVT flooring in living areas"
✅ Good: "Count all doors in the building"

❌ Bad: "Do everything on this page"
❌ Bad: "Measure stuff"
```

### **2. Consistent Naming**
```
✅ Good: "King Units", "Queen Units", "LVT Flooring"
❌ Bad: "count the king units on page 11", "stuff", "things"
```

### **3. Accurate Measurements**
- Use proper scale and calibration
- Measure consistently
- Double-check calculations
- Rate accuracy honestly

### **4. Detailed Feedback**
```
✅ Good: "AI struggled with identifying unit boundaries"
✅ Good: "AI missed some hidden doors"
✅ Good: "AI was very accurate with flooring areas"

❌ Bad: "It was okay"
❌ Bad: "Not good"
```

## 🔄 **Training Workflow**

### **Phase 1: Initial Training (Week 1-2)**
1. **Basic Scopes**: Train on common items (doors, windows, flooring)
2. **Simple Measurements**: Start with straightforward takeoffs
3. **Build Foundation**: Establish basic patterns

### **Phase 2: Advanced Training (Week 3-4)**
1. **Complex Scopes**: Train on complex items (HVAC, electrical, plumbing)
2. **Edge Cases**: Handle unusual situations
3. **Refine Patterns**: Improve based on feedback

### **Phase 3: Continuous Learning (Ongoing)**
1. **New Scopes**: Train on new types of takeoffs
2. **Improvement**: Refine existing patterns
3. **Validation**: Test AI performance regularly

## 📈 **Measuring Training Success**

### **Key Metrics**
- **Accuracy Rate**: How often AI gets it right
- **Pattern Recognition**: How well AI identifies common patterns
- **Scope Coverage**: How many different scopes AI can handle
- **Speed Improvement**: How fast AI becomes vs. manual

### **Success Indicators**
- ✅ AI accuracy > 80% on trained scopes
- ✅ AI can handle new similar scopes
- ✅ AI provides consistent results
- ✅ AI is faster than manual takeoff

## 🛠️ **Technical Implementation**

### **Database Schema**
```sql
-- Training sessions
training_sessions (
  id, project_id, document_id, page_number, 
  scope, status, ai_result, accuracy, feedback
)

-- Human actions
training_actions (
  id, session_id, action_type, coordinates,
  condition_name, measurement_type, value, unit
)

-- Training examples
training_examples (
  id, session_id, scope, human_actions,
  ai_result, accuracy, feedback
)
```

### **API Endpoints**
- `POST /api/training/start` - Start training session
- `POST /api/training/action` - Record human action
- `POST /api/training/complete` - Complete training session
- `GET /api/training/stats` - Get training statistics
- `GET /api/training/examples` - Get training examples

## 🎓 **Training Scenarios**

### **Scenario 1: Door Counting**
```
Scope: "Count all doors in the building"
Training: Click on each door, create "Doors" condition
Expected: AI learns to identify door symbols and count them
```

### **Scenario 2: Flooring Measurement**
```
Scope: "Measure LVT flooring in living areas"
Training: Draw polygons around flooring areas, create "LVT Flooring" condition
Expected: AI learns to identify flooring boundaries and measure areas
```

### **Scenario 3: Window Counting**
```
Scope: "Count windows in bedrooms"
Training: Click on each window, create "Bedroom Windows" condition
Expected: AI learns to identify windows in specific room types
```

## 🔍 **Troubleshooting Training Issues**

### **Common Problems**
1. **Low Accuracy**: Need more training examples
2. **Inconsistent Results**: Need better pattern recognition
3. **Scope Confusion**: Need clearer scope definitions
4. **Measurement Errors**: Need better calibration training

### **Solutions**
1. **More Examples**: Train on more similar scenarios
2. **Better Feedback**: Provide more detailed feedback
3. **Clearer Scopes**: Use more specific scope descriptions
4. **Calibration Training**: Train on scale and measurement accuracy

## 📋 **Training Checklist**

### **Before Training**
- [ ] Project has PDF loaded
- [ ] Clear scope defined
- [ ] Training mode enabled
- [ ] Ready to perform manual takeoff

### **During Training**
- [ ] Perform takeoff as you normally would
- [ ] Create conditions with clear names
- [ ] Place measurements accurately
- [ ] Use proper scale and calibration

### **After Training**
- [ ] Rate accuracy honestly
- [ ] Provide detailed feedback
- [ ] Review AI results
- [ ] Plan next training session

## 🚀 **Next Steps**

1. **Start Training**: Begin with simple scopes
2. **Build Patterns**: Train on common scenarios
3. **Test Performance**: Compare AI vs. manual results
4. **Iterate**: Improve based on feedback
5. **Scale**: Train on more complex scenarios

The key to successful AI training is consistency, accuracy, and detailed feedback. The more examples you provide, the better the AI becomes!
